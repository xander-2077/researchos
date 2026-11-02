import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FlaskConical, Plus, Search } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card, EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/misc";
import { DataTable } from "@/features/common";
import { useAppState } from "@/hooks/app-state";
import { useExperiments } from "@/hooks/queries";
import { formatNumber, label, relativeTime } from "@/lib/utils";
import { EXPERIMENT_STATUSES, EXPERIMENT_TYPES, type Experiment, type MetricSummary } from "@/types/api";
import { t } from "@/i18n";

export function MetricStat({ m }: { m: MetricSummary | undefined }) {
  if (!m) return <span className="text-muted-foreground">—</span>;
  if (m.mixed_units || m.mean === null || m.std === null) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-warning" title={t("Runs report this metric in different units ({units}); convert to one unit to compare.", { units: m.units.map((u) => u || "–").join(", ") })}>
        <AlertTriangle className="size-3.5" />{t("Mixed units")}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap tabular-nums" title={`n=${m.n}`}>
      {formatNumber(m.mean)}
      {m.n > 1 && <span className="text-muted-foreground"> ± {formatNumber(m.std, 2)}</span>}
      {m.unit && <span className="ml-0.5 text-[11px] text-muted-foreground">{m.unit}</span>}
    </span>
  );
}

function ExperimentGroupTable({ items, metricCols, showProject }: { items: Experiment[]; metricCols: string[]; showProject: boolean }) {
  const navigate = useNavigate();
  const cols = useMemo<ColumnDef<Experiment, unknown>[]>(() => {
    const c: ColumnDef<Experiment, unknown>[] = [
      { accessorKey: "name", header: t("Experiment"), cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.name}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{row.original.experiment_key}{row.original.variant && <span className="font-sans"> · {row.original.variant}</span>}</div>
        </div>
      ) },
    ];
    if (showProject) c.push({ accessorKey: "project_title", header: t("Project"), cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{getValue() as string}</span> });
    c.push(
      { accessorKey: "type", header: t("Type"), cell: ({ getValue }) => <span className="text-muted-foreground">{label(getValue() as string)}</span> },
      { accessorKey: "status", header: t("Status"), cell: ({ getValue }) => <Badge value={getValue() as string} /> },
      { accessorKey: "run_count", header: t("Runs"), cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.run_count}{row.original.runs_needing_review > 0 && <span className="ml-1 text-[11px] text-warning">{t("({n} to review)", { n: row.original.runs_needing_review })}</span>}</span> },
      ...metricCols.map<ColumnDef<Experiment, unknown>>((mname) => ({
        id: `m:${mname}`, header: mname, accessorFn: (e) => e.metric_summary[mname]?.mean ?? Number.NEGATIVE_INFINITY,
        cell: ({ row }) => <MetricStat m={row.original.metric_summary[mname]} />,
      })),
      { accessorKey: "updated_at", header: t("Updated"), cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(getValue() as string)}</span> },
    );
    return c;
  }, [metricCols, showProject]);
  return <DataTable data={items} columns={cols} onRowClick={(e) => navigate(`/experiments/${e.id}`)} />;
}

/** Filterable experiment registry. Groups by ablation group; metric columns = mean ± std over runs. */
export function ExperimentRegistry({ projectId, initialStatus = "" }: { projectId?: number | null; initialStatus?: string }) {
  const { openCreate } = useAppState();
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState("");
  const [group, setGroup] = useState("");
  const [metric, setMetric] = useState("");
  const [q, setQ] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [sort, setSort] = useState("-updated_at");
  const [grouped, setGrouped] = useState<"group" | "flat">("group");
  const query = useExperiments({
    project_id: projectId ?? undefined, status, type, q, metric, sort, limit: 200,
    group_name: group || undefined,
    created_after: after ? new Date(after).toISOString() : undefined,
    created_before: before ? new Date(`${before}T23:59:59`).toISOString() : undefined,
  });
  const items = query.data?.items ?? [];
  const allGroups = useMemo(() => Array.from(new Set(items.map((e) => e.group_name).filter(Boolean))).sort(), [items]);
  const allMetrics = useMemo(() => Array.from(new Set(items.flatMap((e) => e.metric_names))).sort(), [items]);
  const groups = useMemo(() => {
    const m = new Map<string, Experiment[]>();
    for (const e of items) m.set(e.group_name || "", [...(m.get(e.group_name || "") ?? []), e]);
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [items]);
  const metricColsFor = (list: Experiment[]) => {
    const names = Array.from(new Set(list.flatMap((e) => e.metric_names)));
    return (metric ? [metric] : names).slice(0, 4);
  };

  return (
    <div className="space-y-3">
      <div className="ros-toolbar">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search experiments" className="pl-8" placeholder="Search experiments…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Experiment status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} options={EXPERIMENT_STATUSES} placeholder="All statuses" />
        <Select aria-label="Experiment type" className="w-32" value={type} onChange={(e) => setType(e.target.value)} options={EXPERIMENT_TYPES} placeholder="All types" />
        <Select aria-label="Experiment group" className="w-44" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="All groups">
          {allGroups.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <Select aria-label="Metric" className="w-36" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Any metric">
          {allMetrics.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Input aria-label="Created after" type="date" className="w-36" value={after} onChange={(e) => setAfter(e.target.value)} title={t("Created after")} />
        <Input aria-label="Created before" type="date" className="w-36" value={before} onChange={(e) => setBefore(e.target.value)} title={t("Created before")} />
        <Select aria-label="Sort experiments" className="w-40" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="-updated_at">{t("Recently updated")}</option>
          <option value="-created_at">{t("Newest")}</option>
          <option value="name">{t("Name")}</option>
          <option value="status">{t("Status")}</option>
          <option value="group_name">{t("Group")}</option>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Segmented ariaLabel="Grouping" value={grouped} onChange={setGrouped} options={[{ value: "group", label: t("By group") }, { value: "flat", label: t("Flat") }]} />
          <Button onClick={() => openCreate({ kind: "experiment", projectId: projectId ?? undefined })}><Plus /> {t("Experiment")}</Button>
        </div>
      </div>
      {query.isLoading ? (
        <Card className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</Card>
      ) : query.isError ? (
        <Card><ErrorState error={query.error} onRetry={() => query.refetch()} /></Card>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<FlaskConical className="size-4" />} title="No experiments" description="Experiments group runs (seeds, configs) under one condition. Agents can record them via MCP record_experiment."
            action={<Button variant="secondary" onClick={() => openCreate({ kind: "experiment", projectId: projectId ?? undefined })}><Plus /> {t("New experiment")}</Button>} />
        </Card>
      ) : grouped === "flat" ? (
        <Card><ExperimentGroupTable items={items} metricCols={metricColsFor(items)} showProject={!projectId} /></Card>
      ) : (
        groups.map(([g, list]) => (
          <Card key={g || "__none"}>
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <h3 className="text-[13px] font-semibold">{g || t("Ungrouped")}</h3>
              <span className="text-xs text-muted-foreground">{t("{n} condition(s) · {m} run(s)", { n: list.length, m: list.reduce((a, e) => a + e.run_count, 0) })}</span>
            </div>
            <ExperimentGroupTable items={list} metricCols={metricColsFor(list)} showProject={!projectId} />
          </Card>
        ))
      )}
    </div>
  );
}
