import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity, AlertOctagon, Archive, ArchiveRestore, ArrowLeft, CalendarClock, ChartGantt, CheckCircle2, Columns3, ExternalLink, Flag,
  FlaskConical, GitBranch, LayoutList, ListTodo, MoreHorizontal, NotebookPen, Pencil, Plus, StickyNote, Target, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState, ErrorState, ProgressBar, Segmented, Skeleton } from "@/components/ui/misc";
import {
  ConfirmDialog, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/overlay";
import { ActivityList, DueDate, Markdown, TaskTable } from "@/features/common";
import { MarkdownInput } from "@/features/markdown-input";
import { TaskKanban } from "@/features/kanban";
import { GanttChart } from "@/features/gantt";
import { IconPicker } from "@/components/icons/project-icons";
import { ExperimentRegistry } from "@/features/experiments";
import { MilestoneFormDialog, ProjectFormDialog } from "@/features/forms";
import { useAppState } from "@/hooks/app-state";
import { useMilestones, useProgressList, useProject, useAllTasks, useProgressPages, useWrite } from "@/hooks/queries";
import { api, type ProjectInput } from "@/services/api";
import { cn, formatDate, formatDateTime, label, relativeTime } from "@/lib/utils";
import { t } from "@/i18n";
import { HEALTHS, MILESTONE_STATUSES, PRIORITIES, SOURCES, STAGES, TASK_STATUSES, type Milestone, type Project } from "@/types/api";

const TABS = ["overview", "milestones", "tasks", "gantt", "experiments", "activity", "notes"] as const;

function ProjectIconEditor({ project }: { project: Project }) {
  const m = useWrite((v: { icon: string; color: string }) => api.updateProject(project.id, { ...v, version: project.version }), { success: "Icon updated" });
  return <IconPicker icon={project.icon} color={project.color} size="lg" onChange={(v) => m.mutate(v)} />;
}

function InlineSelect({ project, field, options, ariaLabel }: { project: Project; field: "stage" | "health_status" | "priority"; options: readonly string[]; ariaLabel: string }) {
  const m = useWrite((v: string) => api.updateProject(project.id, { [field]: v, version: project.version } as ProjectInput), {
    success: (_r, v) => t("{field} → {v}", { field: t(ariaLabel), v: label(v) }),
  });
  return <Select aria-label={ariaLabel} title={t(ariaLabel)} className="w-40" value={project[field]} onChange={(e) => m.mutate(e.target.value)} options={options} disabled={m.isPending} />;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 py-3 text-[13px] sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-3 sm:py-2">
      <dt className="text-muted-foreground">{t(k)}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function OverviewTab({ p }: { p: Project }) {
  const progress = useProgressList(p.id, { limit: 6 });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Research" />
        <dl className="divide-y divide-border px-4">
          <Row k="Research question">{p.research_question}</Row>
          <Row k="Hypothesis">{p.hypothesis}</Row>
          <Row k="Description">{p.description}</Row>
          <Row k="Target venue">{p.target_venue}</Row>
          <Row k="Submission">{p.submission_deadline ? <DueDate date={p.submission_deadline} /> : null}</Row>
          <Row k="Repository">{p.repository_url ? <a href={p.repository_url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-start gap-1 text-primary hover:underline"><GitBranch className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-all">{p.repository_url.replace(/^https?:\/\//, "")}</span></a> : null}</Row>
          <Row k="Last updated">{formatDateTime(p.updated_at)}</Row>
        </dl>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Status" />
          <div className="space-y-3 p-4 text-[13px]">
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{t("Milestone progress")}</span><span className="tabular-nums">{p.milestone_progress.total ? `${p.milestone_progress.completed}/${p.milestone_progress.total}` : t("Not set")}</span></div>
              <ProgressBar value={p.milestone_progress.percent} />
            </div>
            <div className="flex items-start gap-2"><Target className="mt-0.5 size-4 shrink-0 text-primary" /><div><div className="text-xs text-muted-foreground">{t("Next action")}</div>{p.next_action || <span className="text-muted-foreground">—</span>}</div></div>
            <div className="flex items-start gap-2"><Flag className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><div className="text-xs text-muted-foreground">{t("Next milestone")}</div>{p.next_milestone ? <>{p.next_milestone.title} {p.next_milestone.due_date && <span className="text-xs text-muted-foreground">· {formatDate(p.next_milestone.due_date)}</span>}</> : <span className="text-muted-foreground">—</span>}</div></div>
            {(p.blocker_summary || p.blocked_task_count > 0) && (
              <div className="flex items-start gap-2 rounded-md bg-danger/8 p-2 text-danger"><AlertOctagon className="mt-0.5 size-4 shrink-0" /><div><div className="text-xs font-medium">{t("Blockers")}</div>{p.blocker_summary}{p.blocked_tasks.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs">{p.blocked_tasks.map((t) => <li key={t}>{t}</li>)}</ul>}</div></div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent progress" />
          <div className="p-4">
            {progress.isLoading ? <Skeleton className="h-20" /> : progress.data?.items.length ? <ActivityList events={progress.data.items} showProject={false} compact /> : <EmptyState title="No progress yet" />}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MilestoneRow({ m }: { m: Milestone }) {
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const setStatus = useWrite((s: string) => api.updateMilestone(m.id, { status: s as Milestone["status"] }), { success: (_r, s) => t("Milestone → {s}", { s: label(s) }) });
  const del = useWrite(() => api.deleteMilestone(m.id), { success: "Milestone deleted", onSuccess: () => setConfirm(false) });
  const done = m.status === "completed";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span className={cn("z-10 mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border-2 bg-card", done ? "border-success text-success" : m.status === "in_progress" ? "border-primary" : m.status === "cancelled" ? "border-border" : "border-muted-foreground/40")}>
        {done && <CheckCircle2 className="size-3" />}
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={cn("font-medium", m.status === "cancelled" && "text-muted-foreground line-through")}>{m.title}</div>
            {m.description && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{m.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs">{m.due_date ? <DueDate date={m.due_date} done={done || m.status === "cancelled"} /> : <span className="text-muted-foreground">{t("No date")}</span>}</span>
            <Select aria-label={`Status of milestone ${m.title}`} className="w-32" value={m.status} onChange={(e) => setStatus.mutate(e.target.value)} options={MILESTONE_STATUSES} />
            <DropdownMenu>
              <DropdownTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for milestone ${m.title}`}><MoreHorizontal /></Button></DropdownTrigger>
              <DropdownContent>
                <DropdownItem onSelect={() => setEdit(true)}><Pencil /> {t("Edit")}</DropdownItem>
                <DropdownSeparator />
                <DropdownItem className="text-danger" onSelect={() => setConfirm(true)}><Trash2 className="!text-danger" /> {t("Delete")}</DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          </div>
        </div>
        {m.completed_at && <div className="mt-1 text-[11px] text-success">{t("Completed {time}", { time: formatDateTime(m.completed_at) })}</div>}
      </div>
      <MilestoneFormDialog open={edit} onOpenChange={setEdit} projectId={m.project_id} milestone={m} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete milestone?" destructive confirmLabel="Delete" onConfirm={() => del.mutate(undefined)} busy={del.isPending}
        description="Tasks linked to it are kept but unlinked." />
    </li>
  );
}

function MilestonesTab({ p }: { p: Project }) {
  const q = useMilestones(p.id);
  const [add, setAdd] = useState(false);
  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setAdd(true)}><Plus /> {t("Milestone")}</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <Card><EmptyState icon={<Flag className="size-4" />} title="No milestones" description="Define checkpoints with clear completion criteria to track progress honestly." action={<Button variant="secondary" onClick={() => setAdd(true)}><Plus /> {t("Add milestone")}</Button>} /></Card>
      ) : (
        <ol className="relative pl-0">
          <span className="absolute bottom-3 left-[9px] top-3 w-px bg-border" aria-hidden />
          {q.data.map((m) => <MilestoneRow key={m.id} m={m} />)}
        </ol>
      )}
      <MilestoneFormDialog open={add} onOpenChange={setAdd} projectId={p.id} />
    </div>
  );
}

function TasksTab({ p }: { p: Project }) {
  const { openCreate } = useAppState();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [status, setStatus] = useState("");
  const q = useAllTasks({ project_id: p.id, include_archived: p.archived, status, sort: "priority,due_date" });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented ariaLabel="Task view" value={view} onChange={setView} options={[{ value: "kanban", label: <><Columns3 /> {t("Kanban")}</> }, { value: "list", label: <><LayoutList /> {t("List")}</> }]} />
        {view === "list" && <Select aria-label="Task status filter" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} options={TASK_STATUSES} placeholder="All statuses" />}
        <Button size="sm" className="ml-auto" onClick={() => openCreate({ kind: "task", projectId: p.id })}><Plus /> {t("Task")}</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-48" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : view === "kanban" ? (
        <TaskKanban tasks={q.data!.items} showProject={false} onAdd={(s) => openCreate({ kind: "task", projectId: p.id, defaults: { status: s } })} />
      ) : (
        <Card><TaskTable tasks={q.data!.items} showProject={false} empty={<EmptyState icon={<ListTodo className="size-4" />} title="No tasks" />} /></Card>
      )}
    </div>
  );
}

function ActivityTab({ p }: { p: Project }) {
  const [source, setSource] = useState("");
  const q = useProgressPages(p.id, { source });
  return (
    <div className="max-w-3xl space-y-3">
      <Select aria-label="Source filter" className="w-40" value={source} onChange={(e) => setSource(e.target.value)} options={SOURCES} placeholder="All sources" />
      <Card className="p-4">
        {q.isLoading ? <Skeleton className="h-40" /> : q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data?.items.length ? (
          <>
            <ActivityList events={q.data.items} showProject={false} />
            {q.isError && <ErrorState error={q.error} onRetry={() => q.isFetchNextPageError ? q.fetchNextPage() : q.refetch()} />}
            {q.hasNextPage && <Button variant="secondary" size="sm" className="mt-3" disabled={q.isFetching} onClick={() => q.fetchNextPage()}>{t("Load more ({n})", { n: Math.max(0, q.data.total - q.data.items.length) })}</Button>}
          </>
        ) : <EmptyState title="No activity" />}
      </Card>
    </div>
  );
}

function NotesTab({ p }: { p: Project }) {
  const [notes, setNotes] = useState(p.notes);
  const [links, setLinks] = useState(p.links);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { if (!editing) { setNotes(p.notes); setLinks(p.links); } }, [p.notes, p.links, editing]);
  const save = useWrite(() => api.updateProject(p.id, { notes, links: links.filter((l) => l.url.trim()), version: p.version }), {
    success: "Notes saved", onSuccess: () => setEditing(false),
  });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Notes" action={editing ? (
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(false)}>{t("Cancel")}</Button><Button size="sm" onClick={() => { if (!uploading) save.mutate(undefined); }} disabled={save.isPending || uploading}>{t("Save")}</Button></div>
        ) : <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil /> {t("Edit")}</Button>} />
        <div className="p-4">
          {editing ? <MarkdownInput onUploadStateChange={setUploading} aria-label="Project notes" value={notes} onChange={setNotes} rows={18} className="font-mono text-xs" placeholder="# Ideas, decisions, reading notes…" />
            : p.notes ? <Markdown>{p.notes}</Markdown> : <EmptyState icon={<StickyNote className="size-4" />} title="No notes yet" description="Keep lightweight Markdown notes; link out to Overleaf, Notion or Google Docs for long documents." />}
        </div>
      </Card>
      <Card>
        <CardHeader title="External documents" />
        <div className="space-y-2 p-4">
          {editing ? (
            <>
              {links.map((l, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input aria-label={`Link ${i + 1} label`} placeholder="Label" value={l.label} onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="w-28" />
                  <Input aria-label={`Link ${i + 1} URL`} placeholder="https://…" value={l.url} onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                  <Button variant="ghost" size="icon" aria-label="Remove link" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}><Plus /> {t("Link")}</Button>
            </>
          ) : p.links.length ? (
            <ul className="space-y-1.5">{p.links.map((l, i) => (
              <li key={i}><a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-start gap-1.5 text-[13px] text-primary hover:underline"><ExternalLink className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{l.label || l.url}</span></a></li>
            ))}</ul>
          ) : <p className="text-xs text-muted-foreground">{t("No links. Click Edit to add paper drafts, slides or docs.")}</p>}
        </div>
      </Card>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { ref } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { openCreate } = useAppState();
  const q = useProject(ref);
  const [edit, setEdit] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? params.get("tab")! : "overview";
  const archive = useWrite(
    (archived: boolean) => (archived ? api.archiveProject(q.data!.id) : api.updateProject(q.data!.id, { archived: false })),
    { success: (_r, a) => (a ? "Project archived" : "Project restored"), onSuccess: () => setArchiveConfirm(false) },
  );

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-6 w-96" /><Skeleton className="h-72" /></div>;
  if (q.isError || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const p = q.data;

  return (
    <div className="space-y-4">
      <div className="pb-1">
        <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> {t("Projects")}</Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
          <ProjectIconEditor project={p} />
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold leading-tight tracking-tight">{p.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{p.slug}</span>
              {p.target_venue && <span>{p.target_venue}</span>}
              {p.submission_deadline && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" /><DueDate date={p.submission_deadline} /></span>}
              <span>{t("Updated {time}", { time: relativeTime(p.updated_at) })}</span>
              {p.archived && <Badge value="archived" text="Archived" />}
            </div>
          </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openCreate({ kind: "progress", projectId: p.id })}><NotebookPen /> {t("Log progress")}</Button>
            <Button variant="secondary" onClick={() => setEdit(true)}><Pencil /> {t("Edit")}</Button>
            <Button variant="ghost" size="icon" aria-label={p.archived ? "Restore project" : "Archive project"} title={p.archived ? t("Restore") : t("Archive")} onClick={() => (p.archived ? archive.mutate(false) : setArchiveConfirm(true))}>
              {p.archived ? <ArchiveRestore /> : <Archive />}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <InlineSelect project={p} field="stage" options={STAGES} ariaLabel="Research stage" />
          <InlineSelect project={p} field="health_status" options={HEALTHS} ariaLabel="Health" />
          <InlineSelect project={p} field="priority" options={PRIORITIES} ariaLabel="Priority" />
        </div>
        {p.description && <p className="mt-3 max-w-3xl text-[13px] text-muted-foreground">{p.description}</p>}
      </div>

      <Tabs value={tab} onValueChange={(t) => setParams(t === "overview" ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview"><Target /> {t("Overview")}</TabsTrigger>
          <TabsTrigger value="milestones"><Flag /> {t("Milestones")} <span className="text-xs text-muted-foreground">{p.milestone_progress.total || ""}</span></TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo /> {t("Tasks")} <span className="text-xs text-muted-foreground">{p.open_task_count || ""}</span></TabsTrigger>
          <TabsTrigger value="gantt"><ChartGantt /> {t("Gantt")}</TabsTrigger>
          <TabsTrigger value="experiments"><FlaskConical /> {t("Experiments")} <span className="text-xs text-muted-foreground">{p.experiment_count || ""}</span></TabsTrigger>
          <TabsTrigger value="activity"><Activity /> {t("Activity")}</TabsTrigger>
          <TabsTrigger value="notes"><StickyNote /> {t("Notes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab p={p} /></TabsContent>
        <TabsContent value="milestones"><MilestonesTab p={p} /></TabsContent>
        <TabsContent value="tasks"><TasksTab p={p} /></TabsContent>
        <TabsContent value="gantt"><GanttChart projectId={p.id} includeArchived={p.archived} /></TabsContent>
        <TabsContent value="experiments"><ExperimentRegistry projectId={p.id} includeArchived={p.archived} /></TabsContent>
        <TabsContent value="activity"><ActivityTab p={p} /></TabsContent>
        <TabsContent value="notes"><NotesTab p={p} /></TabsContent>
      </Tabs>

      <ProjectFormDialog open={edit} onOpenChange={setEdit} project={p} onSaved={(np) => np.slug !== ref && navigate(`/projects/${np.slug}`, { replace: true })} />
      <ConfirmDialog open={archiveConfirm} onOpenChange={setArchiveConfirm} title="Archive project?" confirmLabel="Archive" onConfirm={() => archive.mutate(true)} busy={archive.isPending}
        description="The project is hidden from the portfolio but nothing is deleted. You can restore it from Projects → Archived." />
    </div>
  );
}
