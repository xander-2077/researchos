import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ExternalLink, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlay";
import { DataTable } from "@/features/common";
import { ExperimentRegistry, MetricStat } from "@/features/experiments";
import { ExperimentFormDialog, RunFormDialog } from "@/features/forms";
import { useAppState } from "@/hooks/app-state";
import { useExperiment, useWrite } from "@/hooks/queries";
import { api } from "@/services/api";
import { formatDateTime, formatNumber, label, relativeTime, shortSha } from "@/lib/utils";
import type { Run } from "@/types/api";

export default function ExperimentsPage() {
  const { projectFilter } = useAppState();
  const [params] = useSearchParams();
  return <ExperimentRegistry projectId={projectFilter} initialStatus={params.get("status") ?? ""} />;
}

function RunActions({ run, onEdit }: { run: Run; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const verify = useWrite((s: string) => api.updateRun(run.id, { verification_status: s }), { success: (_r, s) => `Run marked ${label(s)}` });
  const del = useWrite(() => api.deleteRun(run.id), { success: "Run deleted", onSuccess: () => setConfirm(false) });
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for run ${run.external_run_id}`}><MoreHorizontal /></Button></DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={onEdit}><Pencil /> Edit</DropdownItem>
          {run.verification_status !== "verified" && <DropdownItem onSelect={() => verify.mutate("verified")}><ShieldCheck /> Mark verified</DropdownItem>}
          {run.verification_status !== "rejected" && <DropdownItem onSelect={() => verify.mutate("rejected")}>Reject</DropdownItem>}
          {run.verification_status !== "needs_review" && <DropdownItem onSelect={() => verify.mutate("needs_review")}>Back to review</DropdownItem>}
          <DropdownSeparator />
          <DropdownItem className="text-danger" onSelect={() => setConfirm(true)}><Trash2 className="!text-danger" /> Delete</DropdownItem>
        </DropdownContent>
      </DropdownMenu>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete run?" description={`Run ${run.external_run_id} and its metrics will be removed.`} confirmLabel="Delete" destructive onConfirm={() => del.mutate(undefined)} busy={del.isPending} />
    </div>
  );
}

export function ExperimentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useExperiment(Number(id));
  const [edit, setEdit] = useState(false);
  const [runDialog, setRunDialog] = useState<{ open: boolean; run?: Run }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVerify, setConfirmVerify] = useState(false);
  const verify = useWrite(() => api.updateExperiment(Number(id), { status: "verified" }), { success: "Experiment verified", onSuccess: () => setConfirmVerify(false) });
  const del = useWrite(() => api.deleteExperiment(Number(id)), { success: "Experiment deleted", onSuccess: () => navigate("/experiments") });

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const e = q.data;
  const runs = e.runs ?? [];
  const metricNames = e.metric_names;

  const cols: ColumnDef<Run, unknown>[] = [
    { accessorKey: "external_run_id", header: "Run", cell: ({ row }) => <span className="font-mono text-xs">{row.original.external_run_id}</span> },
    { accessorKey: "seed", header: "Seed", cell: ({ getValue }) => <span className="tabular-nums">{(getValue() as number | null) ?? "—"}</span> },
    { accessorKey: "git_commit", header: "Commit", cell: ({ row }) => row.original.git_commit ? <span className="font-mono text-xs" title={`${row.original.git_commit} (${row.original.git_branch || "?"})`}>{shortSha(row.original.git_commit)}</span> : <span className="text-muted-foreground">—</span> },
    ...metricNames.map<ColumnDef<Run, unknown>>((m) => ({
      id: `m:${m}`, header: m, accessorFn: (r) => r.metrics_json[m]?.value ?? Number.NEGATIVE_INFINITY,
      cell: ({ row }) => {
        const v = row.original.metrics_json[m];
        return v ? <span className="tabular-nums" title={v.description}>{formatNumber(v.value)}{v.unit && <span className="ml-0.5 text-[11px] text-muted-foreground">{v.unit}</span>}</span> : <span className="text-muted-foreground">—</span>;
      },
    })),
    { accessorKey: "status", header: "Status", cell: ({ getValue }) => <span className="text-muted-foreground">{label(getValue() as string)}</span> },
    { accessorKey: "verification_status", header: "Verification", cell: ({ getValue }) => <Badge value={getValue() as string} /> },
    { id: "links", header: "Artifacts", enableSorting: false, cell: ({ row }) => (
      <div className="flex gap-1">{row.original.artifact_links.slice(0, 3).map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" onClick={(ev) => ev.stopPropagation()} className="text-primary" title={l.url}><ExternalLink className="size-3.5" /></a>
      ))}{!row.original.artifact_links.length && <span className="text-muted-foreground">—</span>}</div>
    ) },
    { accessorKey: "updated_at", header: "Updated", cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(getValue() as string)}</span> },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <RunActions run={row.original} onEdit={() => setRunDialog({ open: true, run: row.original })} /> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/projects/${e.project_slug}?tab=experiments`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> {e.project_title}</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{e.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge value={e.status} />
              <Badge value={e.type} />
              {e.group_name && <span>Group: <span className="text-foreground">{e.group_name}</span></span>}
              <span className="font-mono">· {e.experiment_key}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {e.status !== "verified" && <Button variant="secondary" onClick={() => setConfirmVerify(true)}><CheckCircle2 /> Mark verified</Button>}
            <Button variant="secondary" onClick={() => setEdit(true)}><Pencil /> Edit</Button>
            <Button variant="ghost" size="icon" aria-label="Delete experiment" onClick={() => setConfirmDelete(true)}><Trash2 /></Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Design" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-[13px] sm:grid-cols-2">
            {[["Hypothesis", e.hypothesis], ["Baseline", e.baseline], ["Variant", e.variant], ["Description", e.description]].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 whitespace-pre-wrap">{v || <span className="text-muted-foreground">—</span>}</dd></div>
            ))}
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Conclusion</dt><dd className="mt-0.5 whitespace-pre-wrap">{e.conclusion || <span className="text-muted-foreground">No conclusion recorded yet.</span>}</dd></div>
            <div className="text-xs text-muted-foreground sm:col-span-2">Created {formatDateTime(e.created_at)} · Updated {formatDateTime(e.updated_at)}</div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Metrics across runs" sub="mean ± std (sample)" />
          {metricNames.length ? (
            <table className="w-full text-[13px]">
              <tbody>
                {metricNames.map((m) => {
                  const s = e.metric_summary[m];
                  return (
                    <tr key={m} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium">{m}</td>
                      <td className="px-4 py-2 text-right"><MetricStat m={s} /></td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">n={s.n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState title="No metrics yet" description="Add a run with metrics." />}
        </Card>
      </div>

      <Card>
        <CardHeader title={`Runs (${runs.length})`} action={<Button size="sm" onClick={() => setRunDialog({ open: true })}><Plus /> Add run</Button>} />
        <DataTable data={runs} columns={cols} onRowClick={(r) => setRunDialog({ open: true, run: r })}
          empty={<EmptyState title="No runs recorded" description="A run is one execution (seed/config). Re-using a run ID updates it instead of duplicating." />} />
      </Card>

      <ExperimentFormDialog open={edit} onOpenChange={setEdit} experiment={e} />
      <RunFormDialog open={runDialog.open} onOpenChange={(o) => setRunDialog((s) => ({ ...s, open: o }))} experimentId={e.id} run={runDialog.run} />
      <ConfirmDialog open={confirmVerify} onOpenChange={setConfirmVerify} title="Mark experiment as verified?" confirmLabel="Mark verified" onConfirm={() => verify.mutate(undefined)} busy={verify.isPending}
        description="Verified means you have checked the evidence (runs, seeds, metrics) and stand behind the conclusion. Agents cannot change verified results without explicit confirmation." />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete experiment?" destructive confirmLabel="Delete" onConfirm={() => del.mutate(undefined)} busy={del.isPending}
        description={`“${e.name}” and all ${runs.length} run(s) will be permanently removed.`} />
    </div>
  );
}
