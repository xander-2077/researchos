import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertOctagon, ArrowDown, ArrowUp, Bot, CalendarClock, CheckCircle2, ChevronsUpDown, CircleDot, Flag, FlaskConical,
  GitCommitHorizontal, ListTodo, MoreHorizontal, NotebookPen, Pencil, Terminal, Trash2, User,
} from "lucide-react";
import { Badge, ProgressBar } from "@/components/ui/misc";
import { ProjectIcon } from "@/components/icons/project-icons";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, ConfirmDialog } from "@/components/ui/overlay";
import { useWrite } from "@/hooks/queries";
import { api } from "@/services/api";
import { cn, daysUntil, dueLabel, formatDate, formatDateTime, label, relativeTime } from "@/lib/utils";
import { TASK_STATUSES, type ActivityEvent, type DeadlineItem, type Project, type Task, type TaskStatus } from "@/types/api";
import { TaskFormDialog } from "./forms";
import { t } from "@/i18n";
import { localizeSummary } from "@/i18n/activity";

/** Keep single line breaks of plain-text notes (outside fenced code). */
function softBreaks(md: string) {
  return md.split(/(```[\s\S]*?```)/g).map((part, i) => (i % 2 ? part : part.replace(/([^\n])\n(?=[^\n])/g, "$1  \n"))).join("");
}

export function Markdown({ children, className, breaks }: { children: string; className?: string; breaks?: boolean }) {
  return (
    <div className={cn("prose-ros text-[13px]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: (p) => <a {...p} target="_blank" rel="noreferrer noopener" />,
        img: ({ src, alt }) => (
          <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer noopener" className="ros-md-img">
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" />
          </a>
        ),
      }}>
        {breaks ? softBreaks(children) : children}
      </ReactMarkdown>
    </div>
  );
}

export function DueDate({ date, done, className }: { date: string | null; done?: boolean; className?: string }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const n = daysUntil(date)!;
  const overdue = n < 0 && !done;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", overdue ? "font-medium text-danger" : n <= 3 && !done ? "text-[color-mix(in_oklch,var(--warning)_80%,var(--foreground))]" : "", className)} title={formatDate(date, { withYear: true })}>
      {formatDate(date)}
      {!done && <span className="ml-1 text-[11px] opacity-75">· {dueLabel(date)}</span>}
    </span>
  );
}

export function PriorityIcon({ priority }: { priority: string }) {
  const bars = { critical: 4, high: 3, medium: 2, low: 1 }[priority] ?? 0;
  const color = { critical: "bg-danger", high: "bg-warning", medium: "bg-info", low: "bg-muted-foreground/50" }[priority] ?? "bg-muted";
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" title={t("{p} priority", { p: label(priority) })} aria-label={t("{p} priority", { p: label(priority) })}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("w-[3px] rounded-sm", i <= bars ? color : "bg-border")} style={{ height: `${i * 3}px` }} />
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ project card
export function ProjectCard({ p, handle, className }: { p: Project; handle?: ReactNode; className?: string }) {
  const mp = p.milestone_progress;
  return (
    <Link
      to={`/projects/${p.slug}`}
      draggable={false}
      className={cn("ros-project-card group flex h-full min-w-0 flex-col gap-3.5 rounded-lg border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-primary/35 focus-visible:ring-2", className)}
      data-testid="project-card"
    >
      <div className="flex items-center gap-2.5">
        <ProjectIcon icon={p.icon} color={p.color} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[18px] font-semibold leading-tight group-hover:text-primary">{p.title}</h3>
        </div>
        <span className="inline-flex items-center"><PriorityIcon priority={p.priority} /></span>
        {handle}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge value={p.stage} />
        <Badge value={p.health_status} dot />
        {p.archived && <Badge value="archived" text="Archived" />}
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{t("Milestones")}</span>
          <span className="tabular-nums">{mp.total ? `${mp.completed}/${mp.total} · ${Math.round(mp.percent ?? 0)}%` : t("Not set")}</span>
        </div>
        <ProgressBar value={mp.percent} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted-foreground">{t("Next milestone")}</dt>
        <dd className="truncate text-right">{p.next_milestone ? p.next_milestone.title : <span className="text-muted-foreground">—</span>}</dd>
        <dt className="text-muted-foreground">{t("Next deadline")}</dt>
        <dd className="truncate text-right">
          {p.next_deadline ? (
            <span title={p.next_deadline.title}>
              <DueDate date={p.next_deadline.due_date} />
            </span>
          ) : <span className="text-muted-foreground">—</span>}
        </dd>
        <dt className="text-muted-foreground">{t("Open tasks")}</dt>
        <dd className="text-right tabular-nums">{p.open_task_count}</dd>
      </dl>
      {(p.blocker_summary || p.blocked_task_count > 0) && (
        <div className="flex items-start gap-1.5 rounded-md bg-danger/8 px-2 py-1.5 text-xs text-danger">
          <AlertOctagon className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-2">{p.blocker_summary || t("{n} blocked task(s): {list}", { n: p.blocked_task_count, list: p.blocked_tasks.join(", ") })}</span>
        </div>
      )}
      {p.next_action && !p.blocker_summary && (
        <p className="mt-auto line-clamp-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{t("Next:")} </span>{p.next_action}
        </p>
      )}
    </Link>
  );
}

// ------------------------------------------------------------------ generic sortable table
export function DataTable<T>({ data, columns, empty, onRowClick, rowClassName, initialSort = [] }: {
  data: T[]; columns: ColumnDef<T, unknown>[]; empty?: ReactNode; onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string; initialSort?: SortingState;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const table = useReactTable({
    data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });
  if (!data.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-[inherit]">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-muted/55">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                return (
                  <th key={h.id} className="h-9 whitespace-nowrap px-4 text-left text-[11px] font-medium text-muted-foreground" style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}>
                    {sortable ? (
                      <button type="button" className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr
              key={r.id}
              onClick={onRowClick ? () => onRowClick(r.original) : undefined}
              className={cn("border-b border-border/80 transition-colors last:border-0 hover:bg-muted/70", onRowClick && "cursor-pointer", rowClassName?.(r.original))}
            >
              {r.getVisibleCells().map((c) => (
                <td key={c.id} className="h-11 px-4 py-1.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ projects table
export function ProjectTable({ projects }: { projects: Project[] }) {
  const cols = useMemo<ColumnDef<Project, unknown>[]>(() => [
    { accessorKey: "title", header: t("Project"), cell: ({ row }) => (
      <Link to={`/projects/${row.original.slug}`} className="inline-flex items-center gap-2 font-medium hover:text-primary"><ProjectIcon icon={row.original.icon} color={row.original.color} size="sm" />{row.original.title}</Link>
    ) },
    { accessorKey: "stage", header: t("Stage"), cell: ({ getValue }) => <Badge value={getValue() as string} /> },
    { accessorKey: "health_status", header: t("Health"), cell: ({ getValue }) => <Badge value={getValue() as string} dot /> },
    { accessorKey: "priority", header: t("Priority"), sortingFn: (a, b) => prio(a.original.priority) - prio(b.original.priority),
      cell: ({ getValue }) => <span className="inline-flex items-center gap-1.5"><PriorityIcon priority={getValue() as string} />{label(getValue() as string)}</span> },
    { id: "progress", header: t("Milestones"), accessorFn: (p) => p.milestone_progress.percent ?? -1, cell: ({ row }) => {
      const mp = row.original.milestone_progress;
      return mp.total ? <div className="flex w-28 items-center gap-2"><ProgressBar value={mp.percent} /><span className="text-xs tabular-nums text-muted-foreground">{mp.completed}/{mp.total}</span></div> : <span className="text-xs text-muted-foreground">{t("Not set")}</span>;
    } },
    { id: "next_deadline", header: t("Next deadline"), accessorFn: (p) => p.next_deadline?.due_date ?? "9999", cell: ({ row }) => <DueDate date={row.original.next_deadline?.due_date ?? null} /> },
    { accessorKey: "open_task_count", header: t("Open"), cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    { id: "last", header: t("Last activity"), accessorFn: (p) => p.last_activity_at ?? "", cell: ({ row }) => <span className="text-muted-foreground">{relativeTime(row.original.last_activity_at)}</span> },
    { id: "blockers", header: t("Blockers"), enableSorting: false, cell: ({ row }) => {
      const p = row.original;
      const b = p.blocker_summary || (p.blocked_task_count ? t("{n} blocked task(s)", { n: p.blocked_task_count }) : "");
      return b ? <span className="line-clamp-1 max-w-56 text-xs text-danger" title={b}>{b}</span> : <span className="text-muted-foreground">—</span>;
    } },
  ], []);
  return <DataTable data={projects} columns={cols} />;
}

const prio = (p: string) => ({ critical: 0, high: 1, medium: 2, low: 3 })[p] ?? 9;

// ------------------------------------------------------------------ task status quick change + row actions
export function TaskStatusSelect({ task }: { task: Task }) {
  const m = useWrite((s: TaskStatus) => api.updateTask(task.id, { status: s }), { success: (_r, s) => t("Task → {s}", { s: label(s) }) });
  return (
    <select
      aria-label={`Status of ${task.title}`}
      value={task.status}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => m.mutate(e.target.value as TaskStatus)}
      className="h-6 cursor-pointer rounded border border-transparent bg-transparent px-1 text-xs hover:border-border focus:border-border focus:outline-none"
    >
      {TASK_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
    </select>
  );
}

export function TaskActions({ task }: { task: Task }) {
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const del = useWrite(() => api.deleteTask(task.id), { success: "Task deleted", onSuccess: () => setConfirm(false) });
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${task.title}`}><MoreHorizontal /></Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => setEdit(true)}><Pencil /> {t("Edit")}</DropdownItem>
          <DropdownSeparator />
          <DropdownItem onSelect={() => setConfirm(true)} className="text-danger"><Trash2 className="!text-danger" /> {t("Delete")}</DropdownItem>
        </DropdownContent>
      </DropdownMenu>
      <TaskFormDialog open={edit} onOpenChange={setEdit} task={task} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete task?" description={t("“{title}” will be removed. This is recorded in the activity log.", { title: task.title })} confirmLabel="Delete" destructive onConfirm={() => del.mutate(undefined)} busy={del.isPending} />
    </div>
  );
}

export function TaskTable({ tasks, showProject = true, empty }: { tasks: Task[]; showProject?: boolean; empty?: ReactNode }) {
  const [editing, setEditing] = useState<Task | null>(null);
  const cols = useMemo<ColumnDef<Task, unknown>[]>(() => {
    const c: ColumnDef<Task, unknown>[] = [
      { accessorKey: "priority", header: t("P"), size: 40, sortingFn: (a, b) => prio(a.original.priority) - prio(b.original.priority), cell: ({ row }) => <PriorityIcon priority={row.original.priority} /> },
      { accessorKey: "title", header: t("Task"), cell: ({ row }) => (
        <div className="min-w-0">
          <div className={cn("truncate font-medium", row.original.status === "done" && "text-muted-foreground line-through")}>{row.original.title}</div>
          {(row.original.tags.length > 0 || row.original.milestone_title || row.original.git_reference) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {row.original.milestone_title && <span className="inline-flex items-center gap-0.5"><Flag className="size-3" />{row.original.milestone_title}</span>}
              {row.original.tags.map((t) => <span key={t} className="rounded bg-muted px-1">#{t}</span>)}
              {row.original.git_reference && <span className="inline-flex items-center gap-0.5 font-mono"><GitCommitHorizontal className="size-3" />{row.original.git_reference.slice(0, 12)}</span>}
            </div>
          )}
        </div>
      ) },
    ];
    if (showProject) c.push({ accessorKey: "project_title", header: t("Project"), cell: ({ row }) => <Link onClick={(e) => e.stopPropagation()} to={`/projects/${row.original.project_slug}`} className="whitespace-nowrap text-muted-foreground hover:text-foreground">{row.original.project_title}</Link> });
    c.push(
      { accessorKey: "status", header: t("Status"), cell: ({ row }) => <TaskStatusSelect task={row.original} /> },
      { accessorKey: "due_date", header: t("Deadline"), sortingFn: (a, b) => (a.original.due_date ?? "9999").localeCompare(b.original.due_date ?? "9999"), cell: ({ row }) => <DueDate date={row.original.due_date} done={row.original.status === "done" || row.original.status === "cancelled"} /> },
      { id: "actions", header: "", size: 40, enableSorting: false, cell: ({ row }) => <TaskActions task={row.original} /> },
    );
    return c;
  }, [showProject]);
  return (
    <>
      <DataTable
        data={tasks}
        columns={cols}
        empty={empty}
        onRowClick={setEditing}
        rowClassName={(t) => (t.due_date && daysUntil(t.due_date)! < 0 && ["todo", "in_progress", "blocked"].includes(t.status) ? "bg-danger/[0.04]" : "")}
      />
      <TaskFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} task={editing ?? undefined} />
    </>
  );
}

// ------------------------------------------------------------------ activity
const EVENT_ICON: Record<string, ReactNode> = {
  progress_note: <NotebookPen />, task_completed: <CheckCircle2 />, milestone_completed: <Flag />,
  experiment_created: <FlaskConical />, run_recorded: <FlaskConical />, run_updated: <FlaskConical />, run_verified: <CheckCircle2 />,
  stage_changed: <CircleDot />, task_created: <ListTodo />, project_created: <CircleDot />,
};

export function SourceBadge({ source, actor }: { source: string; actor?: string }) {
  const icon = source === "manual" ? <User className="size-3" /> : source === "rest_api" ? <Terminal className="size-3" /> : <Bot className="size-3" />;
  return (
    <span title={actor} className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-px text-[11px] text-muted-foreground">
      {icon}{label(source)}
    </span>
  );
}

export function ActivityList({ events, showProject = true, compact }: { events: ActivityEvent[]; showProject?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol className="relative">
      {events.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0">
          {i < events.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" aria-hidden />}
          <span className={cn("z-10 mt-0.5 flex size-[27px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground [&_svg]:size-3.5",
            e.event_type === "progress_note" && "text-primary", e.event_type.endsWith("completed") || e.event_type === "run_verified" ? "text-success" : "")}>
            {EVENT_ICON[e.event_type] ?? <CircleDot />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={cn("text-[13px]", e.event_type === "progress_note" && "font-medium", compact && "line-clamp-2")}>{localizeSummary(e.summary, e.event_type)}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <time dateTime={e.created_at} title={formatDateTime(e.created_at)}>{compact ? relativeTime(e.created_at) : formatDateTime(e.created_at)}</time>
              {showProject && e.project_slug && <Link to={`/projects/${e.project_slug}`} className="hover:text-foreground">{e.project_title}</Link>}
              <SourceBadge source={e.source} actor={e.actor} />
              {!compact && <span className="rounded bg-muted px-1">{label(e.event_type)}</span>}
              {e.details && <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t("Hide details") : t("Details")}</button>}
            </div>
            {open === e.id && e.details && <div className="mt-2 rounded-md border border-border bg-muted/40 p-3"><Markdown>{e.details}</Markdown></div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ deadlines
export function DeadlineList({ items, compact }: { items: DeadlineItem[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((d) => (
        <li key={`${d.kind}-${d.id}`} className="flex items-center gap-3 py-2">
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5",
            d.kind === "submission" ? "bg-danger/10 text-danger" : d.kind === "milestone" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
            {d.kind === "submission" ? <CalendarClock /> : d.kind === "milestone" ? <Flag /> : <ListTodo />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{d.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              <Link to={`/projects/${d.project_slug}`} className="hover:text-foreground">{d.project_title}</Link> · {label(d.kind)}
              {!compact && d.status && <> · {label(d.status)}</>}
            </div>
          </div>
          <DueDate date={d.due_date} className="text-xs" />
        </li>
      ))}
    </ul>
  );
}
