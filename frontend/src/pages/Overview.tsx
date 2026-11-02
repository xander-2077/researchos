import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertOctagon, CalendarClock, FlaskConical, FolderKanban, LayoutGrid, ListTodo, Plus, Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { ActivityList, DeadlineList, ProjectCard, ProjectTable } from "@/features/common";
import { useAppState } from "@/hooks/app-state";
import { useActivity, useDeadlines, useNeedsReview, useProjects, useSummary } from "@/hooks/queries";
import { cn, relativeTime } from "@/lib/utils";
import { HEALTHS, PRIORITIES, STAGES } from "@/types/api";

function readView(): "grid" | "table" {
  try {
    return localStorage.getItem("researchos-portfolio-view") === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
}

function StatCard({ label, value, icon, to, tone, hint }: { label: string; value: number | undefined; icon: ReactNode; to: string; tone?: "danger" | "warning"; hint?: string }) {
  return (
    <Link to={to} className="group rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40" data-testid={`stat-${label}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={cn("[&_svg]:size-4", tone === "danger" && value ? "text-danger" : tone === "warning" && value ? "text-warning" : "")}>{icon}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        {value === undefined ? <Skeleton className="h-7 w-10" /> : <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone === "danger" && value > 0 && "text-danger")}>{value}</span>}
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </Link>
  );
}

export function Portfolio({ defaultArchived = "active", showArchiveFilter = false }: { defaultArchived?: "active" | "archived" | "all"; showArchiveFilter?: boolean }) {
  const { openCreate } = useAppState();
  const [view, setViewState] = useState<"grid" | "table">(readView);
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState("");
  const [health, setHealth] = useState("");
  const [archived, setArchived] = useState(defaultArchived);
  const [sort, setSort] = useState("priority");
  const setView = (v: "grid" | "table") => {
    setViewState(v);
    try { localStorage.setItem("researchos-portfolio-view", v); } catch { /* ignore */ }
  };
  const q = useProjects({
    stage, priority, health_status: health, sort, limit: 200,
    ...(archived === "all" ? { include_all: true } : { archived: archived === "archived" }),
  });
  const filtered = !!(stage || priority || health);
  return (
    <section aria-label="Projects">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by stage" className="w-40" value={stage} onChange={(e) => setStage(e.target.value)} options={STAGES} placeholder="All stages" />
        <Select aria-label="Filter by priority" className="w-36" value={priority} onChange={(e) => setPriority(e.target.value)} options={PRIORITIES} placeholder="All priorities" />
        <Select aria-label="Filter by health" className="w-36" value={health} onChange={(e) => setHealth(e.target.value)} options={HEALTHS} placeholder="All health" />
        {showArchiveFilter && (
          <Select aria-label="Archived filter" className="w-32" value={archived} onChange={(e) => setArchived(e.target.value as typeof archived)}>
            <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
          </Select>
        )}
        <Select aria-label="Sort projects" className="w-44" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="priority">Sort: Priority</option>
          <option value="next_deadline">Sort: Next deadline</option>
          <option value="last_activity">Sort: Last activity</option>
          <option value="-updated_at">Sort: Last updated</option>
          <option value="stage">Sort: Stage</option>
          <option value="health_status">Sort: Health</option>
          <option value="title">Sort: Name</option>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Segmented ariaLabel="View mode" value={view} onChange={setView} options={[
            { value: "grid", label: <><LayoutGrid /> Cards</>, title: "Card grid" },
            { value: "table", label: <><Rows3 /> Table</>, title: "Table" },
          ]} />
        </div>
      </div>
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-4" />}
            title={filtered ? "No projects match these filters" : archived === "archived" ? "No archived projects" : "No research projects yet"}
            description={filtered ? "Try clearing a filter." : "Create your first project to start tracking milestones, tasks and experiments."}
            action={!filtered && archived !== "archived" ? <Button onClick={() => openCreate({ kind: "project" })}><Plus /> New project</Button> : undefined}
          />
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      ) : (
        <Card><ProjectTable projects={q.data.items} /></Card>
      )}
    </section>
  );
}

export default function OverviewPage() {
  const s = useSummary();
  const deadlines = useDeadlines({ days: 30, include_overdue: true, limit: 8 });
  const activity = useActivity({ limit: 8 });
  const review = useNeedsReview();
  const d = s.data;
  return (
    <div className="space-y-6">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active Projects" value={d?.active_projects} icon={<FolderKanban />} to="/projects" />
        <StatCard label="Open Tasks" value={d?.open_tasks} icon={<ListTodo />} to="/tasks" hint={d?.overdue_tasks ? `${d.overdue_tasks} overdue` : undefined} />
        <StatCard label="Running Experiments" value={d?.running_experiments} icon={<FlaskConical />} to="/experiments?status=running" hint={d?.experiments_needing_review ? `${d.experiments_needing_review} to review` : undefined} />
        <StatCard label="Upcoming Deadlines" value={d?.upcoming_deadlines} icon={<CalendarClock />} to="/timeline" tone="warning" hint="next 14 days" />
        <StatCard label="Blocked Projects" value={d?.blocked_projects} icon={<AlertOctagon />} to="/projects" tone="danger" />
      </section>
      {s.isError && <Card><ErrorState error={s.error} onRetry={() => s.refetch()} /></Card>}

      <Portfolio />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming Deadlines" sub="Next 30 days, incl. overdue" action={<Link to="/timeline" className="text-xs text-primary hover:underline">All</Link>} />
          <div className="px-4 py-1">
            {deadlines.isLoading ? <div className="space-y-2 py-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
              : deadlines.isError ? <ErrorState error={deadlines.error} onRetry={() => deadlines.refetch()} />
              : deadlines.data?.length ? <DeadlineList items={deadlines.data} compact />
              : <EmptyState title="Nothing due soon" description="Deadlines from submissions, milestones and tasks appear here." />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent Research Activity" action={<Link to="/activity" className="text-xs text-primary hover:underline">All</Link>} />
          <div className="px-4 py-3">
            {activity.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
              : activity.isError ? <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
              : activity.data?.items.length ? <ActivityList events={activity.data.items} compact />
              : <EmptyState title="No activity yet" description="Progress notes and changes from the UI, API and agents show up here." />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Experiments Needing Review" action={<Link to="/experiments?status=needs_review" className="text-xs text-primary hover:underline">All</Link>} />
          <div className="px-4 py-1">
            {review.isLoading ? <div className="space-y-2 py-2">{[0, 1].map((i) => <Skeleton key={i} className="h-9" />)}</div>
              : review.isError ? <ErrorState error={review.error} onRetry={() => review.refetch()} />
              : review.data?.length ? (
                <ul className="divide-y divide-border">
                  {review.data.map((e) => (
                    <li key={e.id}>
                      <Link to={`/experiments/${e.id}`} className="flex items-center gap-3 py-2 hover:text-primary">
                        <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{e.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{e.project_title}{e.group_name && ` · ${e.group_name}`} · {e.run_count} run(s) · {relativeTime(e.updated_at)}</div>
                        </div>
                        <Badge value="needs_review" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="All caught up" description="Agent-recorded results land here until you verify them." />}
          </div>
        </Card>
      </section>
    </div>
  );
}
