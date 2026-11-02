// Thin fetch wrapper: same-origin cookie session + CSRF header. No API tokens in the browser.
import type {
  ActivityEvent, ApiToken, DashboardSummary, DeadlineItem, Experiment, Me, Milestone, Page, Project, Run, Task,
} from "@/types/api";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${qs(query)}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", "Cannot reach the ResearchOS server");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    let message: string = err.message ?? `Request failed (${res.status})`;
    if (err.code === "validation_error" && Array.isArray(err.details) && err.details.length) {
      message = err.details
        .map((d: { loc: string[]; msg: string }) => `${d.loc.filter((l) => l !== "body").join(".")}: ${d.msg}`)
        .join("; ");
    }
    throw new ApiError(res.status, err.code ?? "error", message, err.details);
  }
  return data as T;
}

const get = <T>(p: string, q?: Query) => request<T>("GET", p, undefined, q);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const del = <T>(p: string) => request<T>("DELETE", p);

export type ProjectInput = Partial<
  Pick<Project, "title" | "slug" | "description" | "research_question" | "hypothesis" | "target_venue"
    | "submission_deadline" | "stage" | "health_status" | "priority" | "repository_url" | "next_action"
    | "blocker_summary" | "notes" | "links" | "archived">
> & { version?: number };

export type TaskInput = Partial<
  Pick<Task, "project_id" | "milestone_id" | "title" | "description" | "status" | "priority" | "due_date"
    | "tags" | "git_reference" | "notes">
>;
export type MilestoneInput = Partial<Pick<Milestone, "title" | "description" | "status" | "due_date">>;
export type ExperimentInput = Partial<
  Pick<Experiment, "project_id" | "experiment_key" | "group_name" | "name" | "type" | "hypothesis" | "baseline"
    | "variant" | "description" | "status" | "conclusion">
>;
export interface RunInput {
  external_run_id?: string;
  seed?: number | null;
  git_commit?: string;
  git_branch?: string;
  config?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  environment?: string;
  artifact_links?: (string | { label: string; url: string })[];
  status?: string;
  verification_status?: string;
  conclusion?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export const api = {
  me: () => get<Me>("/auth/me"),
  login: (username: string, password: string) => post<{ username: string; csrf_token: string }>("/auth/login", { username, password }),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  // The server rotates the CSRF token (and invalidates all other sessions) on password change.
  changePassword: (current_password: string, new_password: string) =>
    post<{ ok: boolean; csrf_token: string }>("/auth/password", { current_password, new_password }).then((r) => {
      setCsrfToken(r.csrf_token);
      return r;
    }),

  projects: (q?: Query) => get<Page<Project>>("/projects", q),
  project: (ref: string | number) => get<Project>(`/projects/${ref}`),
  createProject: (b: ProjectInput) => post<Project>("/projects", b),
  updateProject: (id: number, b: ProjectInput) => patch<Project>(`/projects/${id}`, b),
  archiveProject: (id: number) => del<Project>(`/projects/${id}`),

  milestones: (projectId: number) => get<Milestone[]>(`/projects/${projectId}/milestones`),
  createMilestone: (projectId: number, b: MilestoneInput) => post<Milestone>(`/projects/${projectId}/milestones`, b),
  updateMilestone: (id: number, b: MilestoneInput) => patch<Milestone>(`/milestones/${id}`, b),
  deleteMilestone: (id: number) => del<void>(`/milestones/${id}`),

  tasks: (q?: Query) => get<Page<Task>>("/tasks", q),
  createTask: (b: TaskInput) => post<Task>("/tasks", b),
  updateTask: (id: number, b: TaskInput) => patch<Task>(`/tasks/${id}`, b),
  deleteTask: (id: number) => del<void>(`/tasks/${id}`),

  experiments: (q?: Query) => get<Page<Experiment>>("/experiments", q),
  experiment: (id: number) => get<Experiment>(`/experiments/${id}`),
  createExperiment: (b: ExperimentInput) => post<Experiment>("/experiments", b),
  updateExperiment: (id: number, b: ExperimentInput & { confirm_overwrite_verified?: boolean }) => patch<Experiment>(`/experiments/${id}`, b),
  deleteExperiment: (id: number) => del<void>(`/experiments/${id}`),
  upsertRun: (experimentId: number, b: RunInput) => post<Run>(`/experiments/${experimentId}/runs`, b),
  updateRun: (id: number, b: RunInput) => patch<Run>(`/runs/${id}`, b),
  deleteRun: (id: number) => del<void>(`/runs/${id}`),

  progress: (projectId: number, q?: Query) => get<Page<ActivityEvent>>(`/projects/${projectId}/progress`, q),
  addProgress: (projectId: number, b: { summary: string; details?: string }) => post<ActivityEvent>(`/projects/${projectId}/progress`, b),

  summary: () => get<DashboardSummary>("/dashboard/summary"),
  deadlines: (q?: Query) => get<DeadlineItem[]>("/dashboard/deadlines", q),
  activity: (q?: Query) => get<Page<ActivityEvent>>("/dashboard/activity", q),
  needsReview: (limit = 8) => get<Experiment[]>("/dashboard/needs-review", { limit }),

  tokens: () => get<ApiToken[]>("/tokens"),
  createToken: (b: { name: string; scopes: string[]; expires_in_days: number | null }) => post<ApiToken & { token: string }>("/tokens", b),
  revokeToken: (id: number) => del<ApiToken>(`/tokens/${id}`),
  exportUrl: "/api/v1/export",
};
