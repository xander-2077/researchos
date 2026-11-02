import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { DeadlineList } from "@/features/common";
import { useAppState } from "@/hooks/app-state";
import { useDeadlines } from "@/hooks/queries";
import { cn, formatDate, parseDate, todayISO } from "@/lib/utils";
import type { DeadlineItem } from "@/types/api";

const KIND_COLOR: Record<string, string> = {
  submission: "bg-danger", milestone: "bg-primary", task: "bg-muted-foreground/60",
};

/** Horizontal near-term timeline: one lane per project, markers at due dates. */
function Lanes({ items, days }: { items: DeadlineItem[]; days: number }) {
  const start = parseDate(todayISO()).getTime();
  const span = days * 86400000;
  const projects = useMemo(() => {
    const m = new Map<string, { title: string; slug: string; items: DeadlineItem[] }>();
    for (const d of items) {
      const e = m.get(d.project_slug) ?? { title: d.project_title, slug: d.project_slug, items: [] };
      e.items.push(d);
      m.set(d.project_slug, e);
    }
    return [...m.values()];
  }, [items]);
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((i * days) / 4));
  const pos = (date: string) => Math.max(0, Math.min(100, ((parseDate(date).getTime() - start) / span) * 100));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px] px-4 py-3">
        <div className="relative ml-44 h-5 text-[11px] text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className={cn("absolute whitespace-nowrap", t === 0 ? "" : t === days ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${(t / days) * 100}%` }}>{t === 0 ? "Today" : formatDate(todayISO(t))}</span>
          ))}
        </div>
        {projects.map((p) => (
          <div key={p.slug} className="flex items-center border-t border-border py-2">
            <Link to={`/projects/${p.slug}`} className="w-44 shrink-0 truncate pr-3 text-[13px] font-medium hover:text-primary">{p.title}</Link>
            <div className="relative h-6 flex-1">
              <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
              {ticks.map((t) => <div key={t} className="absolute top-0 h-full w-px bg-border/60" style={{ left: `${(t / days) * 100}%` }} />)}
              {p.items.map((d) => (
                <span key={`${d.kind}-${d.id}`} title={`${d.title} · ${formatDate(d.due_date)}${d.overdue ? " (overdue)" : ""}`}
                  className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card", KIND_COLOR[d.kind], d.kind === "submission" && "size-3.5 rotate-45 rounded-[2px]", d.overdue && "ring-2 ring-danger/50")}
                  style={{ left: `${pos(d.due_date)}%` }} />
              ))}
            </div>
          </div>
        ))}
        <div className="mt-2 flex gap-4 pl-44 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rotate-45 rounded-[2px] bg-danger" /> Submission</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-primary" /> Milestone</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-muted-foreground/60" /> Task</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full ring-2 ring-danger/50" /> Overdue (pinned to today)</span>
        </div>
      </div>
    </div>
  );
}

function groupByWhen(items: DeadlineItem[]) {
  const groups: [string, DeadlineItem[]][] = [["Overdue", []], ["This week", []], ["Next 30 days", []], ["Later", []]];
  for (const d of items) {
    const i = d.overdue ? 0 : d.days_left <= 7 ? 1 : d.days_left <= 30 ? 2 : 3;
    groups[i][1].push(d);
  }
  return groups.filter(([, v]) => v.length);
}

export default function TimelinePage() {
  const { projectFilter } = useAppState();
  const [days, setDays] = useState(60);
  const [kinds, setKinds] = useState("submission,milestone,task");
  const [overdue, setOverdue] = useState<"yes" | "no">("yes");
  const q = useDeadlines({ days, kinds, include_overdue: overdue === "yes", project_id: projectFilter ?? undefined, limit: 500 });
  const items = q.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Window" className="w-36" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option>
          <option value="60">Next 60 days</option><option value="120">Next 120 days</option><option value="365">Next year</option>
        </Select>
        <Select aria-label="Kinds" className="w-48" value={kinds} onChange={(e) => setKinds(e.target.value)}>
          <option value="submission,milestone,task">All deadline types</option>
          <option value="submission">Paper submissions</option>
          <option value="milestone">Milestones</option>
          <option value="task">Task due dates</option>
          <option value="submission,milestone">Submissions + milestones</option>
        </Select>
        <Segmented ariaLabel="Overdue" value={overdue} onChange={setOverdue} options={[{ value: "yes", label: "Include overdue" }, { value: "no", label: "Upcoming only" }]} />
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card> : !items.length ? (
        <Card><EmptyState icon={<CalendarRange className="size-4" />} title="No deadlines in this window" description="Set submission deadlines on projects, due dates on milestones and tasks." /></Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Near-term timeline" sub={`Next ${days} days by project`} />
            <Lanes items={items} days={days} />
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {groupByWhen(items).map(([title, list]) => (
              <Card key={title}>
                <CardHeader title={title} sub={`${list.length} item(s)`} className={title === "Overdue" ? "text-danger" : ""} />
                <div className="px-4 py-1"><DeadlineList items={list} /></div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
