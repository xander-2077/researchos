import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog } from "@/components/ui/overlay";
import { useMilestones, useAllProjects, useAllTasks, useWrite } from "@/hooks/queries";
import { IconPicker } from "@/components/icons/project-icons";
import { MarkdownInput } from "./markdown-input";
import { api, type RunInput } from "@/services/api";
import { t } from "@/i18n";
import {
  EXPERIMENT_STATUSES, EXPERIMENT_TYPES, HEALTHS, MILESTONE_STATUSES, PRIORITIES, RUN_STATUSES, STAGES,
  TASK_STATUSES, VERIFICATION_STATUSES,
  type Experiment, type Milestone, type Project, type Run, type Task,
} from "@/types/api";

// ------------------------------------------------------------------ helpers
type Errors = Record<string, string | undefined>;

function validate<T>(schema: z.ZodType<T>, values: unknown): { data?: T; errors: Errors } {
  const r = schema.safeParse(values);
  if (r.success) return { data: r.data, errors: {} };
  const errors: Errors = {};
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? "_");
    errors[k] ??= issue.message;
  }
  return { errors };
}

function useForm<T extends Record<string, unknown>>(initial: T, deps: unknown[] = []) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Errors>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setValues(initial); setErrors({}); }, deps);
  const set = <K extends keyof T>(k: K) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return { values, setValues, errors, setErrors, set };
}

const optionalUrl = z.string().trim().max(500).refine((v) => !v || /^(https?:\/\/|\/|~\/|[a-z0-9+.-]+:\/\/)/i.test(v), "Must be a URL or path");
const optDate = z.string().optional().transform((v) => (v ? v : null));
const nonEmpty = (name: string, max = 300) => z.string().trim().min(1, `${name} is required`).max(max, `Max ${max} characters`);

function FormDialog({ open, onOpenChange, title, description, onSubmit, busy, uploading = false, submitLabel, children, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string;
  onSubmit: () => void; busy: boolean; uploading?: boolean; submitLabel: string; children: ReactNode; wide?: boolean;
}) {
  const formId = useMemo(() => `form-${Math.random().toString(36).slice(2)}`, []);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(title)}
      description={description && t(description)}
      wide={wide}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button type="submit" form={formId} disabled={busy || uploading}>{busy ? t("Saving…") : t(submitLabel)}</Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e: FormEvent) => { e.preventDefault(); if (!busy && !uploading) onSubmit(); }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {children}
      </form>
    </Dialog>
  );
}

function ProjectSelect({ value, onChange, error, disabled, optional = false }: { value: string; onChange: (v: string) => void; error?: string; disabled?: boolean; optional?: boolean }) {
  const { data } = useAllProjects();
  return (
    <Field label="Project" required={!optional} error={error} className="sm:col-span-2">
      {(id) => (
        <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={optional ? "No project" : "Select a project…"} aria-invalid={!!error}>
          {data?.items.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
      )}
    </Field>
  );
}

// ------------------------------------------------------------------ Project
const projectSchema = z.object({
  title: nonEmpty("Title", 200),
  slug: z.string().trim().optional().refine((v) => !v || /^[a-z0-9][a-z0-9-]*$/.test(v), "Lowercase letters, digits and dashes"),
  description: z.string().max(20000),
  research_question: z.string().max(5000),
  hypothesis: z.string().max(5000),
  target_venue: z.string().max(200),
  submission_deadline: optDate,
  stage: z.enum(STAGES),
  health_status: z.enum(HEALTHS),
  priority: z.enum(PRIORITIES),
  repository_url: optionalUrl,
  next_action: z.string().max(2000),
  blocker_summary: z.string().max(2000),
  icon: z.string().max(40),
  color: z.string().max(7),
});

export function ProjectFormDialog({ open, onOpenChange, project, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; project?: Project; onSaved?: (p: Project) => void;
}) {
  const init = {
    title: project?.title ?? "", slug: "", description: project?.description ?? "",
    research_question: project?.research_question ?? "", hypothesis: project?.hypothesis ?? "",
    target_venue: project?.target_venue ?? "", submission_deadline: project?.submission_deadline ?? "",
    stage: project?.stage ?? "ideation", health_status: project?.health_status ?? "on_track",
    priority: project?.priority ?? "medium", repository_url: project?.repository_url ?? "",
    next_action: project?.next_action ?? "", blocker_summary: project?.blocker_summary ?? "",
    icon: project?.icon ?? "", color: project?.color ?? "",
  };
  const f = useForm(init, [open, project?.id, project?.version]);
  const m = useWrite(
    (body: z.infer<typeof projectSchema>) => {
      const { slug, ...rest } = body;
      return project ? api.updateProject(project.id, { ...rest, version: project.version }) : api.createProject({ ...rest, ...(slug ? { slug } : {}) });
    },
    { success: project ? "Project updated" : "Project created", onSuccess: (p) => { onOpenChange(false); onSaved?.(p); } },
  );
  const submit = () => {
    const { data, errors } = validate(projectSchema, f.values);
    f.setErrors(errors);
    if (data) m.mutate(data);
  };
  const { values: v, errors: e, set } = f;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={project ? "Edit project" : "New project"} onSubmit={submit} busy={m.isPending} submitLabel={project ? "Save" : "Create project"} wide>
      <Field label="Title" required error={e.title} className="sm:col-span-2">{(id) => (
        <div className="flex items-center gap-2">
          <IconPicker icon={v.icon} color={v.color} size="md" onChange={(x) => f.setValues((s) => ({ ...s, ...x }))} />
          <Input id={id} value={v.title} onChange={set("title")} autoFocus aria-invalid={!!e.title} placeholder="e.g. Multi-Agent Quadruped Soccer" />
        </div>
      )}</Field>
      {!project && <Field label="Slug" error={e.slug} hint="Optional; derived from the title" className="sm:col-span-2">{(id) => <Input id={id} value={v.slug} onChange={set("slug")} placeholder="quadruped-soccer" />}</Field>}
      <Field label="Stage">{(id) => <Select id={id} value={v.stage} onChange={set("stage")} options={STAGES} />}</Field>
      <Field label="Health">{(id) => <Select id={id} value={v.health_status} onChange={set("health_status")} options={HEALTHS} />}</Field>
      <Field label="Priority">{(id) => <Select id={id} value={v.priority} onChange={set("priority")} options={PRIORITIES} />}</Field>
      <Field label="Submission deadline">{(id) => <Input id={id} type="date" value={v.submission_deadline} onChange={set("submission_deadline")} />}</Field>
      <Field label="Target venue">{(id) => <Input id={id} value={v.target_venue} onChange={set("target_venue")} placeholder="CoRL 2027" />}</Field>
      <Field label="Repository URL" error={e.repository_url}>{(id) => <Input id={id} value={v.repository_url} onChange={set("repository_url")} placeholder="https://github.com/…" />}</Field>
      <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.description} onChange={set("description")} />}</Field>
      <Field label="Research question" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.research_question} onChange={set("research_question")} rows={2} />}</Field>
      <Field label="Hypothesis" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.hypothesis} onChange={set("hypothesis")} rows={2} />}</Field>
      <Field label="Next action" className="sm:col-span-2">{(id) => <Input id={id} value={v.next_action} onChange={set("next_action")} />}</Field>
      <Field label="Blockers" className="sm:col-span-2" hint="Leave empty when nothing blocks progress">{(id) => <Input id={id} value={v.blocker_summary} onChange={set("blocker_summary")} />}</Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ Milestone
const milestoneSchema = z.object({
  title: nonEmpty("Title", 200),
  description: z.string().max(10000),
  status: z.enum(MILESTONE_STATUSES),
  due_date: optDate,
});

export function MilestoneFormDialog({ open, onOpenChange, projectId, milestone }: {
  open: boolean; onOpenChange: (o: boolean) => void; projectId: number; milestone?: Milestone;
}) {
  const f = useForm({
    title: milestone?.title ?? "", description: milestone?.description ?? "",
    status: milestone?.status ?? "planned", due_date: milestone?.due_date ?? "",
  }, [open, milestone?.id]);
  const m = useWrite(
    (b: z.infer<typeof milestoneSchema>) => (milestone ? api.updateMilestone(milestone.id, b) : api.createMilestone(projectId, b)),
    { success: milestone ? "Milestone updated" : "Milestone added", onSuccess: () => onOpenChange(false) },
  );
  const submit = () => {
    const { data, errors } = validate(milestoneSchema, f.values);
    f.setErrors(errors);
    if (data) m.mutate(data);
  };
  const { values: v, errors: e, set } = f;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={milestone ? "Edit milestone" : "New milestone"} description="Milestones need a clear completion criterion — progress is computed from them." onSubmit={submit} busy={m.isPending} submitLabel={milestone ? "Save" : "Add milestone"}>
      <Field label="Title" required error={e.title} className="sm:col-span-2">{(id) => <Input id={id} value={v.title} onChange={set("title")} autoFocus aria-invalid={!!e.title} />}</Field>
      <Field label="Status">{(id) => <Select id={id} value={v.status} onChange={set("status")} options={MILESTONE_STATUSES} />}</Field>
      <Field label="Due date">{(id) => <Input id={id} type="date" value={v.due_date} onChange={set("due_date")} />}</Field>
      <Field label="Completion criterion / description" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.description} onChange={set("description")} />}</Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ Task
const taskSchema = z.object({
  project_id: z.union([z.literal("").transform(() => null), z.coerce.number().int().positive()]),
  milestone_id: z.string().optional().transform((v) => (v ? Number(v) : null)),
  title: nonEmpty("Title"),
  description: z.string().max(20000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  start_date: optDate,
  due_date: optDate,
  depends_on: z.array(z.number()),
  tags: z.string().transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean)),
  git_reference: z.string().max(300),
  notes: z.string().max(50000),
}).refine((v) => !v.start_date || !v.due_date || v.start_date <= v.due_date, { path: ["start_date"], message: "Start date must not be after the deadline" });

export function TaskFormDialog({ open, onOpenChange, task, projectId, defaults }: {
  open: boolean; onOpenChange: (o: boolean) => void; task?: Task; projectId?: number; defaults?: Partial<Task>;
}) {
  const f = useForm({
    project_id: String(task?.project_id ?? projectId ?? ""), milestone_id: String(task?.milestone_id ?? defaults?.milestone_id ?? ""),
    title: task?.title ?? "", description: task?.description ?? "", status: task?.status ?? defaults?.status ?? "todo",
    priority: task?.priority ?? "medium", start_date: task?.start_date ?? "", due_date: task?.due_date ?? "",
    depends_on: task?.depends_on ?? ([] as number[]), tags: (task?.tags ?? []).join(", "),
    git_reference: task?.git_reference ?? "", notes: task?.notes ?? "",
  }, [open, task?.id]);
  const pid = Number(f.values.project_id) || undefined;
  const { data: milestones } = useMilestones(pid);
  const { data: siblings } = useAllTasks({ project_id: pid }, { enabled: !!pid });
  const m = useWrite(
    (b: z.infer<typeof taskSchema>) => (task ? api.updateTask(task.id, b) : api.createTask(b)),
    { success: task ? "Task updated" : "Task created", onSuccess: () => onOpenChange(false) },
  );
  const submit = () => {
    const { data, errors } = validate(taskSchema, f.values);
    f.setErrors(errors);
    if (data) m.mutate(data);
  };
  const { values: v, errors: e, set } = f;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={task ? "Edit task" : "New task"} onSubmit={submit} busy={m.isPending} submitLabel={task ? "Save" : "Create task"} wide>
      <ProjectSelect optional value={v.project_id} onChange={(x) => f.setValues((s) => ({ ...s, project_id: x, milestone_id: "", depends_on: [] }))} error={e.project_id} />
      <Field label="Title" required error={e.title} className="sm:col-span-2">{(id) => <Input id={id} value={v.title} onChange={set("title")} autoFocus aria-invalid={!!e.title} />}</Field>
      <Field label="Status">{(id) => <Select id={id} value={v.status} onChange={set("status")} options={TASK_STATUSES} />}</Field>
      <Field label="Priority">{(id) => <Select id={id} value={v.priority} onChange={set("priority")} options={PRIORITIES} />}</Field>
      <Field label="Start date" error={e.start_date}>{(id) => <Input id={id} type="date" value={v.start_date} onChange={set("start_date")} aria-invalid={!!e.start_date} />}</Field>
      <Field label="Deadline">{(id) => <Input id={id} type="date" value={v.due_date} onChange={set("due_date")} />}</Field>
      <Field label="Milestone">
        {(id) => (
          <Select id={id} value={v.milestone_id} onChange={set("milestone_id")} placeholder="None" disabled={!pid}>
            {milestones?.map((ms) => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Depends on" hint="Finish-to-start: this task begins after the selected tasks finish" className="sm:col-span-2">
        {(id) => {
          const options = (siblings?.items ?? []).filter((x) => x.id !== task?.id && x.project_id === pid);
          return options.length ? (
            <div id={id} role="group" className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-input bg-card p-1.5">
              {options.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-accent">
                  <input type="checkbox" className="accent-[var(--primary)]" checked={v.depends_on.includes(o.id)}
                    onChange={(ev) => f.setValues((s) => ({ ...s, depends_on: ev.target.checked ? [...s.depends_on, o.id] : s.depends_on.filter((i) => i !== o.id) }))} />
                  <span className="truncate">{o.title}</span>
                </label>
              ))}
            </div>
          ) : <p id={id} className="text-xs text-muted-foreground">{t(pid ? "No other tasks in this project" : "Select a project to choose prerequisites")}</p>;
        }}
      </Field>
      <Field label="Tags" hint="Comma-separated">{(id) => <Input id={id} value={v.tags} onChange={set("tags")} placeholder="experiment, sim" />}</Field>
      <Field label="Git reference">{(id) => <Input id={id} value={v.git_reference} onChange={set("git_reference")} placeholder="commit SHA, branch or PR URL" />}</Field>
      <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.description} onChange={set("description")} />}</Field>
      <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.notes} onChange={set("notes")} rows={2} />}</Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ Experiment
const experimentSchema = z.object({
  project_id: z.coerce.number().int().positive("Project is required"),
  name: nonEmpty("Name"),
  experiment_key: z.string().trim().optional().refine((v) => !v || /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v), "Letters, digits and . _ : / -"),
  group_name: z.string().max(200),
  type: z.enum(EXPERIMENT_TYPES),
  status: z.enum(EXPERIMENT_STATUSES),
  hypothesis: z.string().max(10000),
  baseline: z.string().max(5000),
  variant: z.string().max(5000),
  description: z.string().max(20000),
  conclusion: z.string().max(10000),
});

export function ExperimentFormDialog({ open, onOpenChange, experiment, projectId, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; experiment?: Experiment; projectId?: number; onSaved?: (e: Experiment) => void;
}) {
  const f = useForm({
    project_id: String(experiment?.project_id ?? projectId ?? ""), name: experiment?.name ?? "", experiment_key: "",
    group_name: experiment?.group_name ?? "", type: experiment?.type ?? "main", status: experiment?.status ?? "planned",
    hypothesis: experiment?.hypothesis ?? "", baseline: experiment?.baseline ?? "", variant: experiment?.variant ?? "",
    description: experiment?.description ?? "", conclusion: experiment?.conclusion ?? "",
  }, [open, experiment?.id]);
  const [descriptionUploading, setDescriptionUploading] = useState(false);
  const [conclusionUploading, setConclusionUploading] = useState(false);
  const m = useWrite(
    (b: z.infer<typeof experimentSchema>) => {
      if (experiment) {
        const { project_id: _p, experiment_key: _k, ...rest } = b;
        return api.updateExperiment(experiment.id, rest);
      }
      const { experiment_key, ...rest } = b;
      return api.createExperiment({ ...rest, ...(experiment_key ? { experiment_key } : {}) });
    },
    { success: experiment ? "Experiment updated" : "Experiment created", onSuccess: (r) => { onOpenChange(false); onSaved?.(r); } },
  );
  const submit = () => {
    const { data, errors } = validate(experimentSchema, f.values);
    f.setErrors(errors);
    if (data) m.mutate(data);
  };
  const { values: v, errors: e, set } = f;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={experiment ? "Edit experiment" : "New experiment"} uploading={descriptionUploading || conclusionUploading} onSubmit={submit} busy={m.isPending} submitLabel={experiment ? "Save" : "Create experiment"} wide>
      <ProjectSelect value={v.project_id} onChange={(x) => f.setValues((s) => ({ ...s, project_id: x }))} error={e.project_id} disabled={!!experiment} />
      <Field label="Name" required error={e.name} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={set("name")} autoFocus aria-invalid={!!e.name} placeholder="Ablation: no world model" />}</Field>
      {!experiment && <Field label="Key" error={e.experiment_key} hint="Stable id for agents; derived from name if empty">{(id) => <Input id={id} value={v.experiment_key} onChange={set("experiment_key")} placeholder="ablation-no-world-model" />}</Field>}
      <Field label="Group" hint="e.g. an ablation study">{(id) => <Input id={id} value={v.group_name} onChange={set("group_name")} placeholder="World-model ablations" />}</Field>
      <Field label="Type">{(id) => <Select id={id} value={v.type} onChange={set("type")} options={EXPERIMENT_TYPES} />}</Field>
      <Field label="Status">{(id) => <Select id={id} value={v.status} onChange={set("status")} options={EXPERIMENT_STATUSES} />}</Field>
      <Field label="Baseline">{(id) => <Input id={id} value={v.baseline} onChange={set("baseline")} />}</Field>
      <Field label="Variant">{(id) => <Input id={id} value={v.variant} onChange={set("variant")} />}</Field>
      <Field label="Hypothesis" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.hypothesis} onChange={set("hypothesis")} rows={2} />}</Field>
      <Field label="Description" className="sm:col-span-2">{(id) => <MarkdownInput id={id} onUploadStateChange={setDescriptionUploading} value={v.description} onChange={(x) => f.setValues((s) => ({ ...s, description: x }))} rows={4} />}</Field>
      <Field label="Conclusion" className="sm:col-span-2">{(id) => <MarkdownInput id={id} onUploadStateChange={setConclusionUploading} value={v.conclusion} onChange={(x) => f.setValues((s) => ({ ...s, conclusion: x }))} rows={3} />}</Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ Run
interface MetricRow { name: string; value: string; unit: string; description: string }

export function RunFormDialog({ open, onOpenChange, experimentId, run }: {
  open: boolean; onOpenChange: (o: boolean) => void; experimentId: number; run?: Run;
}) {
  const toLocal = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const f = useForm({
    external_run_id: run?.external_run_id ?? "", seed: run?.seed?.toString() ?? "", git_commit: run?.git_commit ?? "",
    git_branch: run?.git_branch ?? "", environment: run?.environment ?? "", status: run?.status ?? "completed",
    verification_status: run?.verification_status ?? "needs_review", conclusion: run?.conclusion ?? "",
    config: run && Object.keys(run.config_json).length ? JSON.stringify(run.config_json, null, 2) : "",
    artifacts: (run?.artifact_links ?? []).map((l) => l.url).join("\n"),
    started_at: toLocal(run?.started_at), finished_at: toLocal(run?.finished_at),
  }, [open, run?.id]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  useEffect(() => {
    const rows = Object.entries(run?.metrics_json ?? {}).map(([name, m]) => ({ name, value: String(m.value ?? ""), unit: m.unit ?? "", description: m.description ?? "" }));
    setMetrics(rows.length ? rows : [{ name: "", value: "", unit: "", description: "" }]);
  }, [open, run?.id, run?.metrics_json]);

  const m = useWrite(
    (b: RunInput) => (run ? api.updateRun(run.id, b) : api.upsertRun(experimentId, b)),
    { success: run ? "Run updated" : "Run recorded", onSuccess: () => onOpenChange(false) },
  );

  const submit = () => {
    const v = f.values;
    const errors: Errors = {};
    if (!run && !v.external_run_id.trim()) errors.external_run_id = "Run ID is required (e.g. W&B id or <commit>-seed<n>)";
    if (v.seed && !/^-?\d+$/.test(v.seed)) errors.seed = "Seed must be an integer";
    let config: Record<string, unknown> | undefined;
    if (v.config.trim()) {
      try {
        const parsed = JSON.parse(v.config);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error();
        config = parsed;
      } catch {
        errors.config = "Config must be a JSON object";
      }
    }
    const metricsOut: Record<string, unknown> = {};
    for (const row of metrics) {
      if (!row.name.trim() && !row.value.trim()) continue;
      const num = Number(row.value);
      if (!row.name.trim() || row.value.trim() === "" || !Number.isFinite(num)) {
        errors.metrics = "Each metric needs a name and a numeric value";
        break;
      }
      metricsOut[row.name.trim()] = { value: num, unit: row.unit.trim(), description: row.description.trim() };
    }
    f.setErrors(errors);
    if (Object.keys(errors).length) return;
    const body: RunInput = {
      seed: v.seed ? Number(v.seed) : null, git_commit: v.git_commit.trim(), git_branch: v.git_branch.trim(),
      environment: v.environment.trim(), status: v.status, verification_status: v.verification_status,
      conclusion: v.conclusion, config: config ?? {}, metrics: metricsOut,
      artifact_links: v.artifacts.split("\n").map((s) => s.trim()).filter(Boolean),
      started_at: v.started_at ? new Date(v.started_at).toISOString() : null,
      finished_at: v.finished_at ? new Date(v.finished_at).toISOString() : null,
    };
    if (!run) body.external_run_id = v.external_run_id.trim();
    else body.metrics_mode = "replace";
    m.mutate(body);
  };
  const { values: v, errors: e, set } = f;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={run ? t("Edit run {id}", { id: run.external_run_id }) : "Add run"} description="Store metadata and links only — keep checkpoints, videos and raw logs in your storage." onSubmit={submit} busy={m.isPending} submitLabel={run ? "Save" : "Add run"} wide>
      {!run && <Field label="Run ID" required error={e.external_run_id} hint="Re-using an ID updates that run">{(id) => <Input id={id} value={v.external_run_id} onChange={set("external_run_id")} autoFocus aria-invalid={!!e.external_run_id} placeholder="wandb-3f9x2 or a1b2c3d-seed0" />}</Field>}
      <Field label="Seed" error={e.seed}>{(id) => <Input id={id} value={v.seed} onChange={set("seed")} inputMode="numeric" />}</Field>
      <Field label="Git commit">{(id) => <Input id={id} value={v.git_commit} onChange={set("git_commit")} className="font-mono" />}</Field>
      <Field label="Branch">{(id) => <Input id={id} value={v.git_branch} onChange={set("git_branch")} />}</Field>
      <Field label="Environment / dataset">{(id) => <Input id={id} value={v.environment} onChange={set("environment")} />}</Field>
      <Field label="Run status">{(id) => <Select id={id} value={v.status} onChange={set("status")} options={RUN_STATUSES} />}</Field>
      <Field label="Verification">{(id) => <Select id={id} value={v.verification_status} onChange={set("verification_status")} options={VERIFICATION_STATUSES} />}</Field>
      <Field label="Started">{(id) => <Input id={id} type="datetime-local" value={v.started_at} onChange={set("started_at")} />}</Field>
      <Field label="Finished">{(id) => <Input id={id} type="datetime-local" value={v.finished_at} onChange={set("finished_at")} />}</Field>
      <div className="sm:col-span-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{t("Metrics")}</span>
          <Button size="sm" variant="ghost" onClick={() => setMetrics((r) => [...r, { name: "", value: "", unit: "", description: "" }])}><Plus /> {t("Metric")}</Button>
        </div>
        <div className="space-y-1.5">
          {metrics.map((row, i) => (
            <div key={i} className="grid grid-cols-[1.3fr_1fr_0.7fr_1.4fr_auto] gap-1.5">
              <Input aria-label={`Metric ${i + 1} name`} placeholder="success_rate" value={row.name} onChange={(ev) => setMetrics((r) => r.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <Input aria-label={`Metric ${i + 1} value`} placeholder="0.82" inputMode="decimal" value={row.value} onChange={(ev) => setMetrics((r) => r.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} />
              <Input aria-label={`Metric ${i + 1} unit`} placeholder="%" value={row.unit} onChange={(ev) => setMetrics((r) => r.map((x, j) => (j === i ? { ...x, unit: ev.target.value } : x)))} />
              <Input aria-label={`Metric ${i + 1} description`} placeholder="description (optional)" value={row.description} onChange={(ev) => setMetrics((r) => r.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Remove metric" onClick={() => setMetrics((r) => r.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        {e.metrics && <p className="mt-1 text-xs text-danger" role="alert">{t(e.metrics)}</p>}
      </div>
      <Field label="Config (JSON)" error={e.config} className="sm:col-span-2">{(id) => <Textarea id={id} value={v.config} onChange={set("config")} className="font-mono text-xs" rows={3} placeholder='{"lr": 0.0003, "num_envs": 4096}' />}</Field>
      <Field label="Artifact links" hint="One URL or path per line" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.artifacts} onChange={set("artifacts")} rows={2} placeholder="https://wandb.ai/…" />}</Field>
      <Field label="Conclusion / notes" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.conclusion} onChange={set("conclusion")} rows={2} />}</Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ Progress note
const progressSchema = z.object({
  project_id: z.coerce.number().int().positive("Project is required"),
  summary: nonEmpty("Summary", 1000),
  details: z.string().max(20000),
});

export function ProgressFormDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId?: number }) {
  const f = useForm({ project_id: String(projectId ?? ""), summary: "", details: "" }, [open, projectId]);
  const m = useWrite((b: z.infer<typeof progressSchema>) => api.addProgress(b.project_id, { summary: b.summary, details: b.details }), {
    success: "Progress logged", onSuccess: () => onOpenChange(false),
  });
  const submit = () => {
    const { data, errors } = validate(progressSchema, f.values);
    f.setErrors(errors);
    if (data) m.mutate(data);
  };
  const { values: v, errors: e, set } = f;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Log progress" description="Appended to the project's research log." onSubmit={submit} busy={m.isPending} submitLabel="Log progress">
      <ProjectSelect value={v.project_id} onChange={(x) => f.setValues((s) => ({ ...s, project_id: x }))} error={e.project_id} />
      <Field label="Summary" required error={e.summary} className="sm:col-span-2">{(id) => <Input id={id} value={v.summary} onChange={set("summary")} autoFocus aria-invalid={!!e.summary} placeholder="Finished WBC base compensation; next: sim ablations" />}</Field>
      <Field label="Details (Markdown)" className="sm:col-span-2">{(id) => <Textarea id={id} value={v.details} onChange={set("details")} rows={5} />}</Field>
    </FormDialog>
  );
}
