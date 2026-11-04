import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Flag, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { useDeadlines, useProjects, useTasks, useWrite } from "@/hooks/queries";
import { ProjectIcon } from "@/components/icons/project-icons";
import { api } from "@/services/api";
import { cn, formatDate, parseDate, todayISO } from "@/lib/utils";
import { PX_PER_DAY, computeRange, diffDays, shiftSpan, taskSpan, violatesDependency, xOf, type Span, type Zoom } from "@/lib/gantt";
import type { DeadlineItem, Task } from "@/types/api";
import { locale, t } from "@/i18n";
import { TaskFormDialog } from "./forms";

const PROJECT_ROW = 34;
const TASK_ROW = 36;
const HEADER_H = 48;

type Mode = "move" | "start" | "end";

type Row =
  | { kind: "project"; key: string; id: number | null; slug: string | null; title: string; span: Span | null; done: number; total: number; marks: DeadlineItem[]; top: number; h: number }
  | { kind: "task"; key: string; task: Task; top: number; h: number };

const BAR_TONE: Record<string, string> = {
  todo: "bg-primary/30 text-foreground",
  in_progress: "bg-primary text-primary-foreground",
  // Light text on saturated fills in light mode; dark text on the lighter dark-mode fills.
  blocked: "bg-danger text-white dark:text-[#1b0d10]",
  done: "bg-success/80 text-white dark:text-[#0b1f16]",
};

function loadZoom(): Zoom {
  try {
    const v = localStorage.getItem("researchos-gantt-zoom");
    if (v === "day" || v === "week" || v === "month") return v;
  } catch { /* ignore */ }
  return "week";
}

/** Gantt chart: tasks grouped by project, drag to move / resize, finish-to-start dependency arrows. */
export function GanttChart({ projectId }: { projectId: number | null }) {
  const [zoom, setZoom] = useState<Zoom>(loadZoom);
  const [hideDone, setHideDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number | null>>(new Set());
  const [editing, setEditing] = useState<Task | null>(null);
  const [override, setOverride] = useState<Record<number, Span>>({});
  const [drag, setDrag] = useState<{ id: number; mode: Mode; dx: number } | null>(null);
  const press = useRef<{ x: number; moved: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const px = PX_PER_DAY[zoom];
  const today = todayISO();

  const tasksQ = useTasks({ limit: 500, sort: "due_date", ...(projectId != null ? { project_id: projectId } : {}) });
  const projectsQ = useProjects({ include_all: true, limit: 200 });
  const projectById = useMemo(() => new Map((projectsQ.data?.items ?? []).map((x) => [x.id, x])), [projectsQ.data]);
  const marksQ = useDeadlines({ days: 730, kinds: "milestone,submission", include_overdue: true, limit: 500, project_id: projectId ?? undefined });
  const move = useWrite((v: { id: number; span: Span }) => api.updateTask(v.id, { start_date: v.span.start, due_date: v.span.end }));

  const changeZoom = (z: Zoom) => {
    setZoom(z);
    try { localStorage.setItem("researchos-gantt-zoom", z); } catch { /* ignore */ }
  };

  const spanOf = (task: Task): Span | null => {
    let base = override[task.id] ?? taskSpan(task);
    if (base && drag?.id === task.id) base = shiftSpan(base, drag.mode, Math.round(drag.dx / px));
    return base;
  };

  const { rows, totalH, range } = useMemo(() => {
    const tasks = (tasksQ.data?.items ?? []).filter((x) => x.status !== "cancelled" && !(hideDone && x.status === "done"));
    const marks = marksQ.data ?? [];
    const groups = new Map<number | null, { slug: string | null; title: string; tasks: Task[]; marks: DeadlineItem[] }>();
    for (const x of tasks) {
      const g = groups.get(x.project_id) ?? { slug: x.project_slug, title: x.project_title ?? t("No project"), tasks: [], marks: [] };
      g.tasks.push(x);
      groups.set(x.project_id, g);
    }
    for (const m of marks) groups.get(m.project_id)?.marks.push(m);
    const start = (x: Task) => taskSpan(x)?.start ?? "9999";
    // Projects alphabetically; tasks without a project last.
    const ordered = [...groups.entries()].sort((a, b) => (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0) || a[1].title.localeCompare(b[1].title));
    const out: Row[] = [];
    const spanMap = new Map<number, Span | null>();
    let top = 0;
    for (const [pid, g] of ordered) {
      g.tasks.sort((a, b) => start(a).localeCompare(start(b)) || a.id - b.id);
      const spansHere = g.tasks.map((x) => taskSpan(x)).filter((s): s is Span => !!s);
      const span = spansHere.length ? { start: spansHere.map((s) => s.start).sort()[0], end: spansHere.map((s) => s.end).sort().at(-1)!, complete: true } : null;
      out.push({ kind: "project", key: `p${pid}`, id: pid, slug: g.slug, title: g.title, span, done: g.tasks.filter((x) => x.status === "done").length, total: g.tasks.length, marks: g.marks, top, h: PROJECT_ROW });
      top += PROJECT_ROW;
      if (collapsed.has(pid)) continue;
      for (const x of g.tasks) {
        out.push({ kind: "task", key: `t${x.id}`, task: x, top, h: TASK_ROW });
        spanMap.set(x.id, taskSpan(x));
        top += TASK_ROW;
      }
    }
    const all = [...spanMap.values()].filter((s): s is Span => !!s);
    return { rows: out, totalH: top, range: computeRange(all, today, marks.map((m) => m.due_date)) };
  }, [tasksQ.data, marksQ.data, hideDone, collapsed, today]);

  const W = range.days * px;
  const todayX = xOf(today, range, px);

  // Open centred on today (and again when zoom changes).
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, tasksQ.isSuccess]);

  const header = useMemo(() => {
    const months: { label: string; x: number; w: number }[] = [];
    const ticks: { label: string; x: number; weekend: boolean; major: boolean }[] = [];
    for (let i = 0; i < range.days; i++) {
      const d = parseDate(range.start);
      d.setDate(d.getDate() + i);
      const last = months.at(-1);
      if (!last || last.label !== monthLabel(d)) months.push({ label: monthLabel(d), x: i * px, w: px });
      else last.w += px;
      const dow = d.getDay();
      if (zoom === "day") ticks.push({ label: String(d.getDate()), x: i * px, weekend: dow === 0 || dow === 6, major: d.getDate() === 1 });
      else if (zoom === "week" && dow === 1) ticks.push({ label: String(d.getDate()), x: i * px, weekend: false, major: d.getDate() <= 7 });
    }
    return { months, ticks };
  }, [range, px, zoom]);

  const rowOf = useMemo(() => new Map(rows.filter((r): r is Extract<Row, { kind: "task" }> => r.kind === "task").map((r) => [r.task.id, r])), [rows]);

  const edges = useMemo(() => {
    const out: { key: string; d: string; bad: boolean }[] = [];
    for (const r of rowOf.values()) {
      const succ = spanOf(r.task);
      if (!succ) continue;
      for (const pid of r.task.depends_on ?? []) {
        const pr = rowOf.get(pid);
        const pre = pr && spanOf(pr.task);
        if (!pr || !pre) continue;
        const x1 = xOf(pre.end, range, px) + px, y1 = pr.top + pr.h / 2;
        const x2 = xOf(succ.start, range, px), y2 = r.top + r.h / 2;
        let d: string;
        if (x2 >= x1 + 14) d = `M${x1},${y1} H${x1 + 7} V${y2} H${x2 - 1}`;
        else {
          const ym = y2 > y1 ? y1 + pr.h / 2 : y1 - pr.h / 2;
          d = `M${x1},${y1} H${x1 + 7} V${ym} H${x2 - 8} V${y2} H${x2 - 1}`;
        }
        out.push({ key: `${pid}-${r.task.id}`, d, bad: violatesDependency(pre, succ) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOf, override, drag, range, px]);

  const commit = (task: Task, span: Span) => {
    setOverride((o) => ({ ...o, [task.id]: span }));
    move.mutate({ id: task.id, span }, { onSettled: () => setOverride((o) => { const { [task.id]: _, ...rest } = o; return rest; }) });
  };

  const onDown = (e: PointerEvent<HTMLDivElement>, task: Task, wide: boolean) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = Math.min(8, rect.width / 3);
    const mode: Mode = !wide ? "move" : e.clientX - rect.left <= edge ? "start" : rect.right - e.clientX <= edge ? "end" : "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, moved: false };
    setDrag({ id: task.id, mode, dx: 0 });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!press.current || !drag) return;
    const dx = e.clientX - press.current.x;
    if (Math.abs(dx) > 3) press.current.moved = true;
    setDrag({ ...drag, dx });
  };
  const onUp = (task: Task) => {
    const p = press.current, dr = drag;
    press.current = null;
    setDrag(null);
    if (!p || !dr) return;
    if (!p.moved) { setEditing(task); return; }
    const base = override[task.id] ?? taskSpan(task);
    const delta = Math.round(dr.dx / px);
    if (base && delta !== 0) commit(task, shiftSpan(base, dr.mode, delta));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>, task: Task) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(task); return; }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const base = override[task.id] ?? taskSpan(task);
    if (!base) return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    commit(task, shiftSpan(base, e.shiftKey ? "end" : e.altKey ? "start" : "move", delta));
  };

  if (tasksQ.isLoading) return <Skeleton className="h-72" />;
  if (tasksQ.isError) return <Card><ErrorState error={tasksQ.error} onRetry={() => tasksQ.refetch()} /></Card>;
  if (!rows.length) {
    return <Card><EmptyState title="No tasks to schedule" description="Create tasks with a start date and a deadline to see them here as bars." /></Card>;
  }

  const scrollToToday = () => scroller.current?.scrollTo({ left: Math.max(0, todayX - 120), behavior: "smooth" });
  const LABEL_W = "grid-cols-[150px_auto] sm:grid-cols-[250px_auto]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented ariaLabel={t("Zoom")} value={zoom} onChange={changeZoom} options={[
          { value: "day", label: t("Day") }, { value: "week", label: t("Week") }, { value: "month", label: t("Month") },
        ]} />
        <Button variant="secondary" onClick={scrollToToday}>{t("Today")}</Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="accent-[var(--primary)]" />
          {t("Hide completed")}
        </label>
        <Legend />
      </div>
      <Card className="overflow-hidden">
        <div ref={scroller} className="max-h-[calc(100vh-15rem)] min-h-[16rem] overflow-auto" data-testid="gantt-scroller">
          <div className={cn("grid", LABEL_W)} style={{ width: "max-content", minWidth: "100%" }}>
            {/* corner */}
            <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-card" style={{ height: HEADER_H }} />
            {/* time header */}
            <div className="sticky top-0 z-20 border-b border-border bg-card" style={{ height: HEADER_H, width: W }}>
              <div className="relative h-6">
                {header.months.map((m) => (
                  <div key={m.x} className="absolute top-0 flex h-6 items-center border-l border-border px-2 text-[11px] font-medium text-foreground/80" style={{ left: m.x, width: m.w }}>
                    <span className="truncate">{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="relative h-6">
                {header.ticks.map((tk) => (
                  <span key={tk.x} className={cn("absolute top-0 flex h-6 items-center text-[10px] text-muted-foreground", zoom === "day" ? "justify-center" : "pl-1", tk.weekend && "text-muted-foreground/60")}
                    style={{ left: tk.x, width: zoom === "day" ? px : undefined }}>{tk.label}</span>
                ))}
                <span className="absolute top-1 -translate-x-1/2 rounded-full bg-primary px-1.5 text-[10px] font-medium leading-4 text-primary-foreground" style={{ left: todayX + px / 2 }}>{t("Today")}</span>
              </div>
            </div>

            {/* labels */}
            <div className="sticky left-0 z-10 border-r border-border bg-card">
              {rows.map((r) =>
                r.kind === "project" ? (
                  <div key={r.key} className="flex items-center gap-1 border-b border-border bg-muted/60 px-2" style={{ height: r.h }}>
                    <button type="button" aria-label={collapsed.has(r.id) ? t("Expand") : t("Collapse")} aria-expanded={!collapsed.has(r.id)}
                      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent"
                      onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                      {collapsed.has(r.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </button>
                    {r.id === null ? <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"><Inbox className="size-3" /></span>
                      : <ProjectIcon icon={projectById.get(r.id)?.icon} color={projectById.get(r.id)?.color} size="xs" />}
                    <Link to={r.slug ? `/projects/${r.slug}` : "/tasks"} className="min-w-0 flex-1 truncate text-[13px] font-medium hover:text-primary">{r.title}</Link>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{r.done}/{r.total}</span>
                  </div>
                ) : (
                  <button key={r.key} type="button" onClick={() => setEditing(r.task)}
                    className="flex w-full cursor-pointer items-center gap-2 border-b border-border/60 pl-8 pr-2 text-left hover:bg-accent/60" style={{ height: r.h }}>
                    <span className={cn("size-2 shrink-0 rounded-full", r.task.status === "done" ? "bg-success" : r.task.status === "blocked" ? "bg-danger" : r.task.status === "in_progress" ? "bg-primary" : "bg-muted-foreground/40")} />
                    <span className={cn("truncate text-[13px]", r.task.status === "done" && "text-muted-foreground line-through")}>{r.task.title}</span>
                  </button>
                ),
              )}
            </div>

            {/* chart body */}
            <div className="relative" style={{ width: W, height: totalH }}>
              {zoom === "day" && header.ticks.filter((tk) => tk.weekend).map((tk) => (
                <div key={tk.x} className="absolute top-0 bg-muted/60" style={{ left: tk.x, width: px, height: totalH }} />
              ))}
              {header.months.map((m) => <div key={m.x} className="absolute top-0 w-px bg-border" style={{ left: m.x, height: totalH }} />)}
              {zoom === "week" && header.ticks.map((tk) => <div key={tk.x} className="absolute top-0 w-px bg-border/50" style={{ left: tk.x, height: totalH }} />)}
              {rows.map((r) => <div key={r.key} className={cn("absolute inset-x-0 border-b", r.kind === "project" ? "border-border bg-muted/40" : "border-border/60")} style={{ top: r.top, height: r.h }} />)}
              <div className="pointer-events-none absolute top-0 z-[5] w-px bg-primary/70" style={{ left: todayX + px / 2, height: totalH }} />

              {rows.map((r) => {
                if (r.kind === "project") {
                  return (
                    <div key={r.key} className="absolute inset-x-0" style={{ top: r.top, height: r.h }}>
                      {r.span && (
                        <div className="absolute top-[13px] h-2 rounded-full bg-foreground/20" style={{ left: xOf(r.span.start, range, px), width: Math.max(px, (diffDays(r.span.start, r.span.end) + 1) * px) }} />
                      )}
                      {[...r.marks].sort((x, y) => x.due_date.localeCompare(y.due_date)).map((m, i, arr) => {
                        const next = arr[i + 1];
                        const room = next ? (diffDays(m.due_date, next.due_date) * px) : Infinity;
                        const showLabel = zoom !== "month" && room > m.title.length * 6 + 24;
                        return (
                        <span key={`${m.kind}-${m.id}`} title={`${m.kind === "submission" ? t("Submission") : t("Milestone")}: ${m.title} · ${formatDate(m.due_date)}`}
                          className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1" style={{ left: xOf(m.due_date, range, px) + px / 2 }}>
                          {m.kind === "submission" ? <Flag className="size-3.5 fill-danger text-danger" /> : <span className="size-2.5 rotate-45 rounded-[2px] bg-primary" />}
                          {showLabel && <span className="absolute left-3 whitespace-nowrap text-[10px] text-muted-foreground">{m.title}</span>}
                        </span>
                        );
                      })}
                    </div>
                  );
                }
                const task = r.task;
                const span = spanOf(task);
                if (!span) {
                  return (
                    <button key={r.key} type="button" onClick={() => setEditing(task)} style={{ top: r.top + 7, left: todayX + px + 8, height: r.h - 14 }}
                      className="absolute cursor-pointer rounded-lg border border-dashed border-input px-2 text-[11px] text-muted-foreground hover:bg-accent">
                      {t("Set dates")}
                    </button>
                  );
                }
                const x = xOf(span.start, range, px);
                const w = Math.max(px, (diffDays(span.start, span.end) + 1) * px);
                const wide = w >= 36;
                const dragging = drag?.id === task.id;
                const dep = (task.depends_on ?? []).some((id) => { const p = rowOf.get(id); const ps = p && spanOf(p.task); return ps && violatesDependency(ps, span); });
                return (
                  <div key={r.key}>
                    <div
                      role="button" tabIndex={0}
                      aria-label={`${task.title}: ${formatDate(span.start)} → ${formatDate(span.end)}`}
                      title={`${task.title}\n${formatDate(span.start)} → ${formatDate(span.end)} · ${diffDays(span.start, span.end) + 1}${t("d")}${dep ? `\n⚠ ${t("Starts before a prerequisite finishes")}` : ""}`}
                      onPointerDown={(e) => onDown(e, task, wide)} onPointerMove={onMove} onPointerUp={() => onUp(task)}
                      onPointerCancel={() => { press.current = null; setDrag(null); }}
                      onKeyDown={(e) => onKey(e, task)}
                      className={cn(
                        "absolute flex touch-none select-none items-center overflow-hidden rounded-lg px-2 text-[11px] font-medium outline-offset-2",
                        BAR_TONE[task.status] ?? BAR_TONE.todo, !span.complete && "opacity-80",
                        dragging ? "cursor-grabbing shadow-[0_4px_14px_rgb(0_0_0/0.22)]" : "cursor-grab", dep && "ring-2 ring-danger/70",
                        dragging && drag?.mode !== "move" && "cursor-ew-resize",
                      )}
                      style={{ left: x + 1, width: w - 2, top: r.top + 7, height: r.h - 14, zIndex: dragging ? 8 : 6 }}
                    >
                      {wide && <span className="pointer-events-none absolute inset-y-1 left-0.5 w-1 rounded-full bg-current opacity-30" />}
                      {w >= 90 && <span className="pointer-events-none truncate px-1">{task.title}</span>}
                      {wide && <span className="pointer-events-none absolute inset-y-1 right-0.5 w-1 rounded-full bg-current opacity-30" />}
                    </div>
                    {w < 90 && <span className="pointer-events-none absolute whitespace-nowrap text-[11px] text-muted-foreground" style={{ left: x + w + 6, top: r.top + 10 }}>{task.title}</span>}
                  </div>
                );
              })}

              <svg className="pointer-events-none absolute left-0 top-0 z-[7]" width={W} height={totalH} aria-hidden>
                <defs>
                  <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" /></marker>
                  <marker id="gantt-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--danger)" /></marker>
                </defs>
                {edges.map((e) => (
                  <path key={e.key} d={e.d} fill="none" strokeWidth={1.5} stroke={e.bad ? "var(--danger)" : "var(--muted-foreground)"}
                    strokeOpacity={e.bad ? 0.95 : 0.7} markerEnd={`url(#${e.bad ? "gantt-arrow-bad" : "gantt-arrow"})`} data-testid="gantt-edge" />
                ))}
              </svg>
            </div>
          </div>
        </div>
      </Card>
      <p className="sr-only">{t("Drag a bar to reschedule, drag its edges to resize. Keyboard: ←/→ move, Shift+←/→ change the end date, Enter edit.")}</p>
      <TaskFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} task={editing ?? undefined} />
    </div>
  );
}

function monthLabel(d: Date) {
  return d.toLocaleDateString(locale(), { year: "numeric", month: "long" });
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><span className={cn("size-2.5 rounded-sm", cls)} />{t(label)}</span>
  );
  return (
    <div className="ml-auto hidden flex-wrap items-center gap-3 md:flex">
      {item("bg-primary/30", "Todo")}{item("bg-primary", "In Progress")}{item("bg-danger", "Blocked")}{item("bg-success/80", "Done")}
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><span className="size-2 rotate-45 rounded-[2px] bg-primary" />{t("Milestone")}</span>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Flag className="size-3 fill-danger text-danger" />{t("Submission")}</span>
    </div>
  );
}
