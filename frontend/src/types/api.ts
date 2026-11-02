// Types mirroring backend Pydantic schemas (app/schemas/entities.py).

export const STAGES = [
  "ideation", "research_design", "implementation", "experimentation", "analysis",
  "writing", "submission", "revision", "completed", "on_hold",
] as const;
export type Stage = (typeof STAGES)[number];

export const HEALTHS = ["on_track", "at_risk", "blocked"] as const;
export type Health = (typeof HEALTHS)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MILESTONE_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const EXPERIMENT_STATUSES = [
  "planned", "running", "analyzing", "needs_review", "verified", "failed", "cancelled",
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_TYPES = ["main", "ablation", "baseline", "sweep", "sanity_check", "other"] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

export const RUN_STATUSES = ["planned", "running", "completed", "failed", "cancelled"] as const;
export const VERIFICATION_STATUSES = ["unverified", "needs_review", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const SOURCES = ["manual", "claude_code", "codex", "rest_api", "mcp", "system"] as const;
export type Source = (typeof SOURCES)[number];

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Link {
  label: string;
  url: string;
}

export interface DeadlineRef {
  kind: "submission" | "milestone" | "task";
  id?: number;
  title: string;
  due_date: string;
}

export interface Project {
  id: number;
  slug: string;
  title: string;
  description: string;
  research_question: string;
  hypothesis: string;
  target_venue: string;
  submission_deadline: string | null;
  stage: Stage;
  health_status: Health;
  priority: Priority;
  repository_url: string;
  next_action: string;
  blocker_summary: string;
  notes: string;
  links: Link[];
  archived: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  milestone_progress: { completed: number; total: number; percent: number | null };
  next_milestone: { id: number; title: string; due_date: string | null; status: string } | null;
  next_deadline: DeadlineRef | null;
  open_task_count: number;
  blocked_task_count: number;
  blocked_tasks: string[];
  experiment_count: number;
  last_activity_at: string | null;
}

export interface Milestone {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: MilestoneStatus;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  project_id: number;
  milestone_id: number | null;
  client_key: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  tags: string[];
  git_reference: string;
  notes: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_slug: string | null;
  project_title: string | null;
  milestone_title: string | null;
}

export interface MetricValue {
  value: number | null;
  unit: string;
  description: string;
}

export interface MetricSummary {
  /** null when runs report this metric in different units (mixed_units) */
  mean: number | null;
  std: number | null;
  n: number;
  min: number | null;
  max: number | null;
  unit: string;
  units: string[];
  mixed_units: boolean;
}

export interface Run {
  id: number;
  experiment_id: number;
  external_run_id: string;
  seed: number | null;
  git_commit: string;
  git_branch: string;
  config_json: Record<string, unknown>;
  metrics_json: Record<string, MetricValue>;
  environment: string;
  artifact_links: Link[];
  status: string;
  verification_status: VerificationStatus;
  conclusion: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Experiment {
  id: number;
  project_id: number;
  experiment_key: string;
  group_name: string;
  name: string;
  type: ExperimentType;
  hypothesis: string;
  baseline: string;
  variant: string;
  description: string;
  status: ExperimentStatus;
  conclusion: string;
  created_at: string;
  updated_at: string;
  run_count: number;
  metric_names: string[];
  metric_summary: Record<string, MetricSummary>;
  runs_needing_review: number;
  project_slug: string | null;
  project_title: string | null;
  runs?: Run[];
}

export interface ActivityEvent {
  id: number;
  project_id: number | null;
  related_resource_type: string;
  related_resource_id: number | null;
  event_type: string;
  summary: string;
  details: string;
  source: Source;
  actor: string;
  created_at: string;
  project_slug: string | null;
  project_title: string | null;
}

export interface DeadlineItem {
  kind: "submission" | "milestone" | "task";
  id: number;
  title: string;
  due_date: string;
  status: string | null;
  priority: string | null;
  project_id: number;
  project_slug: string;
  project_title: string;
  overdue: boolean;
  days_left: number;
}

export interface DashboardSummary {
  active_projects: number;
  open_tasks: number;
  running_experiments: number;
  upcoming_deadlines: number;
  blocked_projects: number;
  overdue_tasks: number;
  experiments_needing_review: number;
  milestones_completed_last_7d: number;
}

export interface ApiToken {
  id: number;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface Me {
  authenticated: boolean;
  username?: string;
  csrf_token?: string;
  setup_required?: boolean;
}
