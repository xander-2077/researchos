import { useState } from "react";
import { Activity as ActivityIcon, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { ActivityList } from "@/features/common";
import { useAppState } from "@/hooks/app-state";
import { useActivity } from "@/hooks/queries";
import { SOURCES } from "@/types/api";

const EVENT_TYPES = [
  "progress_note", "project_created", "stage_changed", "health_changed", "task_created", "task_completed",
  "milestone_created", "milestone_completed", "experiment_created", "run_recorded", "run_verified",
];

export default function ActivityPage() {
  const { projectFilter } = useAppState();
  const [source, setSource] = useState("");
  const [eventType, setEventType] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const query = useActivity({
    project_id: projectFilter ?? undefined, source, event_type: eventType, q, limit,
    since: since ? new Date(since).toISOString() : undefined,
    until: until ? new Date(`${until}T23:59:59`).toISOString() : undefined,
  });
  return (
    <div className="max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search activity" className="pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Source" className="w-36" value={source} onChange={(e) => setSource(e.target.value)} options={SOURCES} placeholder="All sources" />
        <Select aria-label="Event type" className="w-44" value={eventType} onChange={(e) => setEventType(e.target.value)} options={EVENT_TYPES} placeholder="All events" />
        <Input aria-label="Since" type="date" className="w-36" value={since} onChange={(e) => setSince(e.target.value)} title="From" />
        <Input aria-label="Until" type="date" className="w-36" value={until} onChange={(e) => setUntil(e.target.value)} title="To" />
      </div>
      <Card className="p-4">
        {query.isLoading ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
          : query.data?.items.length ? (
            <>
              <ActivityList events={query.data.items} />
              {query.data.total > query.data.items.length && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => setLimit((l) => Math.min(l + 50, 200))} disabled={limit >= 200}>
                  {limit >= 200 ? "Narrow filters to see older events" : `Load more (${query.data.total - query.data.items.length})`}
                </Button>
              )}
            </>
          ) : <EmptyState icon={<ActivityIcon className="size-4" />} title="No matching activity" />}
      </Card>
    </div>
  );
}
