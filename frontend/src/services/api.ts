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

export interface UploadedImage { url: string; name: string; size: number; content_type: string }

/** Upload an image (raw body) for use in Markdown fields. */
async function uploadImage(file: Blob, signal?: AbortSignal): Promise<UploadedImage> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": file.type || "application/octet-stream" };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch("/api/v1/uploads", { method: "POST", headers, credentials: "same-origin", body: file, signal });
  } catch {
    throw new ApiError(0, "network_error", "Cannot reach the ResearchOS server");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    // A 413 from a reverse proxy has no JSON body; say what actually went wrong.
    if (res.status === 413) throw new ApiError(413, "payload_too_large", "Image is too large for the server");
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as UploadedImage;
}

const get = <T>(p: string, q?: Query) => request<T>("GET", p, undefined, q);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const del = <T>(p: string) => request<T>("DELETE", p);

/** Fetch complete collections in bounded pages for tables, boards and selectors. */
async function allPages<T>(fetchPage: (q: Query) => Promise<Page<T>>, q: Query = {}, signal?: AbortSignal): Promise<Page<T>> {
  const items: T[] = [];
  let offset = 0;
  while (true) {
    signal?.throwIfAborted();
    const page = await fetchPage({ ...q, limit: 100, offset });
    signal?.throwIfAborted();
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total) return { items, total: page.total, offset: 0, limit: items.length };
    if (!page.items.length) throw new ApiError(0, "incomplete_page", "The list changed while loading. Please retry.");
  }
}

export type ProjectInput = Partial<
  Pick<Project, "title" | "slug" | "description" | "research_question" | "hypothesis" | "target_venue"
    | "submission_deadline" | "stage" | "health_status" | "priority" | "repository_url" | "next_action"
    | "blocker_summary" | "notes" | "links" | "archived" | "icon" | "color">
> & { version?: number };

export type TaskInput = Partial<
  Pick<Task, "project_id" | "milestone_id" | "title" | "description" | "status" | "priority" | "sort_order" | "start_date" | "due_date"
    | "depends_on" | "tags" | "git_reference" | "notes">
>;
export type MilestoneInput = Partial<Pick<Milestone, "title" | "description" | "status" | "due_date">>;
export type ExperimentInput = Partial<
  Pick<Experiment, "project_id" | "experiment_key" | "group_name" | "name" | "type" | "hypothesis" | "baseline"
    | "variant" | "description" | "status" | "conclusion">
>;
export interface RunInput {
  metrics_mode?: "merge" | "replace";
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
  uploadImage,
  me: () => get<Me>("/auth/me"),
  login: (username: string, password: string) => post<{ username: string; csrf_token: string }>("/auth/login", { username, password }),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  // The server rotates the CSRF token (and invalidates all other sessions) on password change.
  changePassword: (current_password: string, new_password: string) =>
    post<{ ok: boolean; csrf_token: string }>("/auth/password", { current_password, new_password }).then((r) => {
      setCsrfToken(r.csrf_token);
      return r;
    }),

  allProjects: (q?: Query, signal?: AbortSignal) => allPages((page) => get<Page<Project>>("/projects", page), q, signal),
  projects: (q?: Query) => get<Page<Project>>("/projects", q),
  project: (ref: string | number) => get<Project>(`/projects/${ref}`),
  createProject: (b: ProjectInput) => post<Project>("/projects", b),
  updateProject: (id: number, b: ProjectInput) => patch<Project>(`/projects/${id}`, b),
  reorderProjects: (ids: number[]) => post<void>("/projects/reorder", { ids }),
  archiveProject: (id: number) => del<Project>(`/projects/${id}`),

  milestones: (projectId: number) => get<Milestone[]>(`/projects/${projectId}/milestones`),
  createMilestone: (projectId: number, b: MilestoneInput) => post<Milestone>(`/projects/${projectId}/milestones`, b),
  updateMilestone: (id: number, b: MilestoneInput) => patch<Milestone>(`/milestones/${id}`, b),
  deleteMilestone: (id: number) => del<void>(`/milestones/${id}`),

  allTasks: (q?: Query, signal?: AbortSignal) => allPages((page) => get<Page<Task>>("/tasks", page), q, signal),
  tasks: (q?: Query) => get<Page<Task>>("/tasks", q),
  createTask: (b: TaskInput) => post<Task>("/tasks", b),
  updateTask: (id: number, b: TaskInput) => patch<Task>(`/tasks/${id}`, b),
  deleteTask: (id: number) => del<void>(`/tasks/${id}`),

  allExperiments: (q?: Query, signal?: AbortSignal) => allPages((page) => get<Page<Experiment>>("/experiments", page), q, signal),
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
