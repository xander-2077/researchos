import { useState } from "react";
import { Columns3, LayoutList, ListTodo, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { TaskTable } from "@/features/common";
import { TaskKanban } from "@/features/kanban";
import { useAppState } from "@/hooks/app-state";
import { useTasks } from "@/hooks/queries";
import { cn, todayISO } from "@/lib/utils";
import { PRIORITIES, TASK_STATUSES } from "@/types/api";
import { t } from "@/i18n";

type Preset = "open" | "blocked" | "week" | "overdue" | "top" | "all";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "top", label: "Top priority" },
  { id: "week", label: "Due in 7 days" },
  { id: "overdue", label: "Overdue" },
  { id: "blocked", label: "Blocked" },
  { id: "all", label: "All" },
];

export default function TasksPage() {
  const { projectFilter, openCreate } = useAppState();
  const [preset, setPreset] = useState<Preset>("open");
  const [view, setViewState] = useState<"table" | "kanban">(() => {
    try { return localStorage.getItem("researchos-tasks-view") === "kanban" ? "kanban" : "table"; } catch { return "table"; }
  });
  const setView = (v: "table" | "kanban") => {
    setViewState(v);
    try { localStorage.setItem("researchos-tasks-view", v); } catch { /* ignore */ }
  };
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [dueAfter, setDueAfter] = useState("");
  const [dueBefore, setDueBefore] = useState("");
  const [q, setQ] = useState("");

  const presetQuery: Record<string, string | boolean | undefined> = {
    open: { open_only: true },
    top: { open_only: true, priority: "critical,high" },
    week: { open_only: true, due_after: todayISO(), due_before: todayISO(7) },
    overdue: { overdue: true },
    blocked: { status: "blocked" },
    all: {},
  }[preset] as Record<string, string | boolean | undefined>;

  const query = useTasks({
    ...presetQuery,
    project_id: projectFilter ?? undefined,
    ...(status ? { status, open_only: false } : {}),
    ...(priority ? { priority } : {}),
    ...(dueAfter ? { due_after: dueAfter } : {}),
    ...(dueBefore ? { due_before: dueBefore } : {}),
    q,
    sort: "priority,due_date",
    limit: 200,
  });
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label="Task presets">
        {PRESETS.map((p) => (
          <button key={p.id} role="tab" aria-selected={preset === p.id} type="button" onClick={() => setPreset(p.id)}
            className={cn("h-10 shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-0.5 text-[13px] font-medium transition-colors",
              preset === p.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t(p.label)}
          </button>
        ))}
      </div>
      <div className="ros-toolbar">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search tasks" className="pl-8" placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} options={TASK_STATUSES} placeholder="Any status" />
        <Select aria-label="Priority" className="w-36" value={priority} onChange={(e) => setPriority(e.target.value)} options={PRIORITIES} placeholder="Any priority" />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("Deadline")}</span>
          <Input aria-label="Due after" type="date" className="w-36" value={dueAfter} onChange={(e) => setDueAfter(e.target.value)} title={t("Due after")} />
          <span aria-hidden>–</span>
          <Input aria-label="Due before" type="date" className="w-36" value={dueBefore} onChange={(e) => setDueBefore(e.target.value)} title={t("Due before")} />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">{t("{n} task(s)", { n: query.data?.total ?? 0 })}</span>
          <Segmented ariaLabel="Task view" value={view} onChange={setView} options={[{ value: "table", label: <><LayoutList /> {t("Table")}</> }, { value: "kanban", label: <><Columns3 /> {t("Kanban")}</> }]} />
          <Button onClick={() => openCreate({ kind: "task", projectId: projectFilter ?? undefined })}><Plus /> {t("Task")}</Button>
        </div>
      </div>
      {query.isLoading ? (
        <Card className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</Card>
      ) : query.isError ? (
        <Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>
      ) : view === "kanban" ? (
        <TaskKanban tasks={items} />
      ) : (
        <Card>
          <TaskTable tasks={items} empty={<EmptyState icon={<ListTodo className="size-4" />} title="No tasks match" description="Change the preset or filters, or create a task." />} />
        </Card>
      )}
    </div>
  );
}
