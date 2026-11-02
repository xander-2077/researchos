import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertOctagon, CalendarClock, FlaskConical, FolderKanban, LayoutGrid, ListTodo, Plus, Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { ActivityList, DeadlineList, ProjectTable } from "@/features/common";
import { SortableProjectGrid } from "@/features/project-grid";
import { useAppState } from "@/hooks/app-state";
import { useActivity, useDeadlines, useNeedsReview, useProjects, useSummary } from "@/hooks/queries";
import { cn, relativeTime } from "@/lib/utils";
import { t } from "@/i18n";

function readView(): "grid" | "table" {
  try {
    return localStorage.getItem("researchos-portfolio-view") === "table" ? "table" : "grid";
  } catch {
    return "grid";
  }
}

function StatCard({ label, value, icon, to, tone, hint }: { label: string; value: number | undefined; icon: ReactNode; to: string; tone?: "danger" | "warning"; hint?: string }) {
  return (
    <Link to={to} className="group min-w-0 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/35 hover:bg-muted/30" data-testid={`stat-${label}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t(label)}</span>
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/80 [&_svg]:size-3.5", tone === "danger" && value ? "bg-danger/8 text-danger" : tone === "warning" && value ? "bg-warning/8 text-warning" : "")}>{icon}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {value === undefined ? <Skeleton className="h-8 w-10" /> : <span className={cn("text-[28px] font-semibold leading-tight tabular-nums tracking-tight", tone === "danger" && value > 0 && "text-danger")}>{value}</span>}
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </Link>
  );
}

export function Portfolio({ defaultArchived = "active", showArchiveFilter = false, action }: {
  defaultArchived?: "active" | "archived" | "all"; showArchiveFilter?: boolean; action?: ReactNode;
}) {
  const { openCreate } = useAppState();
  const [view, setViewState] = useState<"grid" | "table">(readView);
  const [archived, setArchived] = useState(defaultArchived);
  const setView = (v: "grid" | "table") => {
    setViewState(v);
    try { localStorage.setItem("researchos-portfolio-view", v); } catch { /* ignore */ }
  };
  // Few projects, one order: the manual (drag-and-drop) order is used everywhere.
  const q = useProjects({
    sort: "manual", limit: 200,
    ...(archived === "all" ? { include_all: true } : { archived: archived === "archived" }),
  });
  return (
    <section aria-label="Projects">
      <div className="ros-toolbar mb-4">
        <h2 className="text-sm font-semibold">{t("Projects")}</h2>
        {q.data && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">{q.data.total}</span>}
        {view === "grid" && (q.data?.items.length ?? 0) > 1 && <span className="hidden text-xs text-muted-foreground sm:inline">{t("Drag cards to reorder")}</span>}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {showArchiveFilter && (
            <Select aria-label="Archived filter" className="w-32" value={archived} onChange={(e) => setArchived(e.target.value as typeof archived)}>
              <option value="active">{t("Active")}</option><option value="archived">{t("Archived")}</option><option value="all">{t("All")}</option>
            </Select>
          )}
          <Segmented ariaLabel="View mode" value={view} onChange={setView} options={[
            { value: "grid", label: <><LayoutGrid /> {t("Cards")}</> },
            { value: "table", label: <><Rows3 /> {t("Table")}</> },
          ]} />
          {action}
        </div>
      </div>
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-4" />}
            title={archived === "archived" ? "No archived projects" : "No research projects yet"}
            description="Create your first project to start tracking milestones, tasks and experiments."
            action={archived !== "archived" ? <Button onClick={() => openCreate({ kind: "project" })}><Plus /> {t("New project")}</Button> : undefined}
          />
        </Card>
      ) : view === "grid" ? (
        <SortableProjectGrid projects={q.data.items} />
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
    <div className="space-y-7">
      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active Projects" value={d?.active_projects} icon={<FolderKanban />} to="/projects" />
        <StatCard label="Open Tasks" value={d?.open_tasks} icon={<ListTodo />} to="/tasks" hint={d?.overdue_tasks ? t("{n} overdue", { n: d.overdue_tasks }) : undefined} />
        <StatCard label="Running Experiments" value={d?.running_experiments} icon={<FlaskConical />} to="/experiments?status=running" hint={d?.experiments_needing_review ? t("{n} to review", { n: d.experiments_needing_review }) : undefined} />
        <StatCard label="Upcoming Deadlines" value={d?.upcoming_deadlines} icon={<CalendarClock />} to="/timeline" tone="warning" hint={t("next 14 days")} />
        <StatCard label="Blocked Projects" value={d?.blocked_projects} icon={<AlertOctagon />} to="/projects" tone="danger" />
      </section>
      {s.isError && <Card><ErrorState error={s.error} onRetry={() => s.refetch()} /></Card>}

      <Portfolio />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming Deadlines" sub="Next 30 days, incl. overdue" action={<Link to="/timeline" className="text-xs text-primary hover:underline">{t("All")}</Link>} />
          <div className="px-4 py-1">
            {deadlines.isLoading ? <div className="space-y-2 py-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
              : deadlines.isError ? <ErrorState error={deadlines.error} onRetry={() => deadlines.refetch()} />
              : deadlines.data?.length ? <DeadlineList items={deadlines.data} compact />
              : <EmptyState title="Nothing due soon" description="Deadlines from submissions, milestones and tasks appear here." />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent Research Activity" action={<Link to="/activity" className="text-xs text-primary hover:underline">{t("All")}</Link>} />
          <div className="px-4 py-3">
            {activity.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
              : activity.isError ? <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
              : activity.data?.items.length ? <ActivityList events={activity.data.items} compact />
              : <EmptyState title="No activity yet" description="Progress notes and changes from the UI, API and agents show up here." />}
          </div>
        </Card>
        <Card>
          <CardHeader title="Experiments Needing Review" action={<Link to="/experiments?status=needs_review" className="text-xs text-primary hover:underline">{t("All")}</Link>} />
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
                          <div className="truncate text-[11px] text-muted-foreground">{e.project_title}{e.group_name && ` · ${e.group_name}`} · {t("{n} run(s)", { n: e.run_count })} · {relativeTime(e.updated_at)}</div>
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
