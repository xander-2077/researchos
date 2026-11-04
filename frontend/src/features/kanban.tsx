import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useWrite } from "@/hooks/queries";
import { api } from "@/services/api";
import { cn, label } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/api";
import { t } from "@/i18n";
import { DueDate, PriorityIcon, TaskStatusSelect } from "./common";
import { TaskFormDialog } from "./forms";

const KANBAN_COLS: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const GAP = 1024;

interface Target { status: TaskStatus; index: number }
interface DragState { task: Task; x: number; y: number; offX: number; offY: number; width: number; over: Target | null }
type Placement = { status: TaskStatus; sort_order: number };

/** sort_order for a card dropped between `prev` and `next` (either may be missing). */
export function orderBetween(prev?: number, next?: number): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + GAP;
  if (next !== undefined) return next - GAP;
  return GAP;
}

const byOrder = (a: Task, b: Task) => a.sort_order - b.sort_order || a.id - b.id;

/**
 * Kanban with pointer-based drag & drop (mouse, touch and pen): move cards between columns and
 * reorder them inside a column. Mouse: drag the card. Touch/pen: drag the grip so scrolling still
 * works. Keyboard: focus the grip, ↑/↓ reorders; the status select moves between columns.
 */
export function TaskKanban({ tasks, showProject = true, onAdd }: { tasks: Task[]; showProject?: boolean; onAdd?: (s: TaskStatus) => void }) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<Record<number, Placement>>({});
  const suppressClick = useRef(false);
  const write = useWrite((v: { id: number } & Partial<Placement>) => api.updateTask(v.id, { status: v.status, sort_order: v.sort_order }));

  const columns = useMemo(() => {
    const placed = tasks.map((x) => (pending[x.id] ? { ...x, ...pending[x.id] } : x));
    return Object.fromEntries(KANBAN_COLS.map((s) => [s, placed.filter((x) => x.status === s).sort(byOrder)])) as Record<TaskStatus, Task[]>;
  }, [tasks, pending]);

  const place = (task: Task, target: Target) => {
    const col = columns[target.status].filter((x) => x.id !== task.id);
    const prev = col[target.index - 1]?.sort_order, next = col[target.index]?.sort_order;
    const current = columns[task.status];
    const at = current.findIndex((x) => x.id === task.id);
    // Same column and same neighbours: nothing to do.
    if (target.status === task.status && current[at - 1]?.sort_order === prev && current[at + 1]?.sort_order === next) return;
    const p: Placement = { status: target.status, sort_order: orderBetween(prev, next) };
    setPending((m) => ({ ...m, [task.id]: p }));
    const statusChanged = target.status !== task.status;
    write.mutate(
      { id: task.id, sort_order: p.sort_order, ...(statusChanged ? { status: p.status } : {}) },
      {
        onSuccess: () => { if (statusChanged) toast.success(t("Moved to {s}", { s: label(p.status) })); },
        onSettled: () => setPending((m) => { const { [task.id]: _, ...rest } = m; return rest; }),
      },
    );
  };

  const targetAt = (x: number, y: number, dragId: number): Target | null => {
    const colEl = document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-kanban-col]");
    if (!colEl) return null;
    const status = colEl.dataset.kanbanCol as TaskStatus;
    const cards = [...colEl.querySelectorAll<HTMLElement>("[data-kanban-card]")].filter((el) => Number(el.dataset.taskId) !== dragId);
    const index = cards.filter((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
    return { status, index };
  };

  const startDrag = (e: ReactPointerEvent<HTMLElement>, task: Task, fromHandle: boolean) => {
    if (e.button !== 0) return;
    if (e.pointerType !== "mouse" && !fromHandle) return; // touch: only via handle
    if ((e.target as HTMLElement).closest("select,button:not([data-drag-handle]),a")) return;
    const card = (e.currentTarget.closest("[data-kanban-card]") as HTMLElement) ?? e.currentTarget;
    const rect = card.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    let active = fromHandle && e.pointerType !== "mouse";
    if (active) e.preventDefault();
    const base = { task, offX: sx - rect.left, offY: sy - rect.top, width: rect.width };
    if (active) setDrag({ ...base, x: sx, y: sy, over: null });

    let raf = 0, px = sx, py = sy;
    // Continuous auto-scroll while the pointer rests near the top/bottom edge (stacked columns on phones).
    const tick = () => {
      const edge = 70;
      const dy = py < edge ? -Math.ceil((edge - py) / 5) : py > window.innerHeight - edge ? Math.ceil((py - window.innerHeight + edge) / 5) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        setDrag((d) => (d ? { ...d, over: targetAt(px, py, task.id) } : d));
      }
      raf = requestAnimationFrame(tick);
    };
    if (active) raf = requestAnimationFrame(tick);
    const onMove = (ev: PointerEvent) => {
      px = ev.clientX; py = ev.clientY;
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        active = true;
        raf = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      setDrag({ ...base, x: ev.clientX, y: ev.clientY, over: targetAt(ev.clientX, ev.clientY, task.id) });
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      cancelAnimationFrame(raf);
      if (active) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        const target = cancelled ? null : targetAt(ev.clientX, ev.clientY, task.id);
        if (target) place(task, target);
      }
      setDrag(null);
    };
    const onUp = (ev: PointerEvent) => finish(ev, false);
    const onCancel = (ev: PointerEvent) => finish(ev, true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, task: Task) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const col = columns[task.status];
    const at = col.findIndex((x) => x.id === task.id);
    const to = e.key === "ArrowUp" ? at - 1 : at + 1;
    if (to < 0 || to >= col.length) return;
    place(task, { status: task.status, index: to });
  };

  const cardBody = (task: Task, withHandle: boolean) => (
    <>
      <div className="flex items-start gap-1.5">
        {withHandle && (
          <button
            type="button"
            data-drag-handle
            aria-label={t("Drag to move")}
            title={t("Drag to move (↑/↓ to reorder)")}
            onPointerDown={(e) => { e.stopPropagation(); startDrag(e, task, true); }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => onHandleKey(e, task)}
            className="-ml-1 mt-px cursor-grab touch-none rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        <span className="flex-1 text-[13px] font-medium leading-snug">{task.title}</span>
        <PriorityIcon priority={task.priority} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{showProject ? task.project_title ?? t("No project") : task.milestone_title ?? ""}</span>
        {task.due_date && <DueDate date={task.due_date} done={task.status === "done"} className="text-[11px]" />}
      </div>
    </>
  );

  return (
    <>
      <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4", drag && "select-none")}>
        {KANBAN_COLS.map((s) => {
          const items = columns[s];
          const over = drag?.over?.status === s ? drag.over : null;
          const visible = drag ? items.filter((x) => x.id !== drag.task.id || !drag.over) : items;
          return (
            <div
              key={s}
              data-kanban-col={s}
              className={cn("flex min-h-48 min-w-0 flex-col rounded-lg border border-transparent bg-muted/65 transition-colors", over && over.index >= 0 && drag?.task.status !== s && "border-primary/50 bg-primary/5")}
              data-testid={`kanban-${s}`}
            >
              <div className="flex min-h-12 items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs font-medium"><Badge value={s} dot /><span className="tabular-nums text-muted-foreground">{items.length}</span></div>
                {onAdd && <Button variant="ghost" size="icon-sm" aria-label={t("Add {s} task", { s: label(s) })} onClick={() => onAdd(s)}><Plus /></Button>}
              </div>
              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {visible.map((task, i) => (
                  <div key={task.id} className="contents">
                    {over && over.index === i && <div className="h-12 shrink-0 rounded-md border-2 border-dashed border-primary/40" aria-hidden data-testid="kanban-placeholder" />}
                    <div
                      data-kanban-card
                      data-task-id={task.id}
                      onPointerDown={(e) => startDrag(e, task, false)}
                      onClick={() => !suppressClick.current && setEditing(task)}
                      className={cn("cursor-pointer rounded-md border border-border bg-card p-3 shadow-xs transition-colors hover:border-primary/35", drag?.task.id === task.id && "opacity-40")}
                    >
                      {cardBody(task, true)}
                      <div className="mt-1.5 md:hidden" onClick={(e) => e.stopPropagation()}><TaskStatusSelect task={task} /></div>
                    </div>
                  </div>
                ))}
                {over && over.index >= visible.length && <div className="h-12 shrink-0 rounded-md border-2 border-dashed border-primary/40" aria-hidden data-testid="kanban-placeholder" />}
              </div>
            </div>
          );
        })}
      </div>
      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rotate-1 rounded-md border border-primary/50 bg-card p-2.5 shadow-xl"
          style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width }}
        >
          {cardBody(drag.task, false)}
        </div>
      )}
      <TaskFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} task={editing ?? undefined} />
    </>
  );
}

