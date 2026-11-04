// Minimal in-memory stand-in for the ResearchOS REST API, used by UI tests via a mocked fetch.
import { vi } from "vitest";
import { todayISO } from "@/lib/utils";

type Json = Record<string, unknown>;

export interface FakeState {
  authenticated: boolean;
  isAdmin: boolean;
  projects: Json[];
  tasks: Json[];
  experiments: Json[];
  milestones: Json[];
  calls: { method: string; path: string; body?: Json; headers: Record<string, string> }[];
}

let nextId = 100;

export function makeProject(over: Json = {}): Json {
  const id = (over.id as number) ?? nextId++;
  const title = (over.title as string) ?? `Project ${id}`;
  return {
    id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, description: "", research_question: "", hypothesis: "",
    target_venue: "", submission_deadline: null, stage: "ideation", health_status: "on_track", priority: "medium",
    repository_url: "", next_action: "", blocker_summary: "", notes: "", links: [], archived: false, icon: "", color: "", sort_order: id,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1,
    milestone_progress: { completed: 0, total: 0, percent: null }, next_milestone: null, next_deadline: null,
    open_task_count: 0, blocked_task_count: 0, blocked_tasks: [], experiment_count: 0, last_activity_at: new Date().toISOString(),
    ...over,
  };
}

const page = (items: Json[]) => ({ items, total: items.length, limit: 50, offset: 0 });

export function installFakeApi(init: Partial<FakeState> = {}): FakeState {
  const state: FakeState = { authenticated: true, isAdmin: true, projects: [], tasks: [], experiments: [], milestones: [], calls: [], ...init };
  const json = (data: unknown, status = 200) =>
    Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));

  vi.stubGlobal("fetch", (input: string, opts: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = (opts.method ?? "GET").toUpperCase();
    const body = typeof opts.body === "string" ? (JSON.parse(opts.body) as Json) : undefined;
    state.calls.push({ method, path, body, headers: (opts.headers ?? {}) as Record<string, string> });
    const q = url.searchParams;
    let m: RegExpMatchArray | null;

    if (path === "/auth/me") return json(state.authenticated ? { authenticated: true, username: "admin", user_id: 1, is_admin: state.isAdmin, csrf_token: "csrf-1" } : { authenticated: false, setup_required: false });
    if (path === "/auth/logout" && method === "POST") {
      state.authenticated = false;
      return json({ ok: true });
    }
    if (path === "/auth/login" && method === "POST") {
      if (body?.password !== "correct-horse-1") return json({ error: { code: "unauthorized", message: "Invalid username or password" } }, 401);
      state.authenticated = true;
      return json({ username: "admin", user_id: 1, is_admin: state.isAdmin, csrf_token: "csrf-2" });
    }
    if (!state.authenticated) return json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

    if (path === "/uploads" && method === "POST") {
      const blob = opts.body as Blob;
      const ext = blob.type === "image/jpeg" ? "jpg" : "png";
      return json({ url: `/api/v1/uploads/${"a".repeat(32)}.${ext}`, name: `${"a".repeat(32)}.${ext}`, size: blob.size, content_type: blob.type }, 201);
    }

    if (path === "/projects" && method === "GET") {
      let items = state.projects.filter((p) => q.get("include_all") === "true" || String(p.archived) === (q.get("archived") ?? "false"));
      if (q.get("stage")) items = items.filter((p) => p.stage === q.get("stage"));
      if (q.get("q")) items = items.filter((p) => String(p.title).toLowerCase().includes(q.get("q")!.toLowerCase()));
      return json(page(items));
    }
    if (path === "/projects/reorder" && method === "POST") {
      const ids = body!.ids as number[];
      state.projects.sort((x, y) => ids.indexOf(x.id as number) - ids.indexOf(y.id as number));
      return json(null, 204);
    }
    if (path === "/projects" && method === "POST") {
      if (!body?.title) return json({ error: { code: "validation_error", message: "Invalid", details: [{ loc: ["body", "title"], msg: "required" }] } }, 422);
      const p = makeProject(body);
      state.projects.push(p);
      return json(p, 201);
    }
    if ((m = path.match(/^\/projects\/([^/]+)$/))) {
      const p = state.projects.find((x) => String(x.id) === m![1] || x.slug === m![1]);
      if (!p) return json({ error: { code: "not_found", message: "Project not found" } }, 404);
      if (method === "PATCH") {
        Object.assign(p, Object.fromEntries(Object.entries(body!).filter(([k]) => k !== "version")), { version: (p.version as number) + 1 });
      }
      return json(p);
    }
    if ((m = path.match(/^\/projects\/(\d+)\/milestones$/))) return json(state.milestones.filter((x) => x.project_id === Number(m![1])));
    if ((m = path.match(/^\/projects\/(\d+)\/progress$/))) return json(method === "POST" ? { id: 1, ...body } : page([]));

    if (path === "/tasks" && method === "GET") {
      let items = state.tasks;
      const pid = q.get("project_id");
      if (pid) items = items.filter((t) => (pid === "0" ? t.project_id == null : t.project_id === Number(pid)));
      return json(page(items));
    }
    if (path === "/tasks" && method === "POST") {
      const p = state.projects.find((x) => x.id === body!.project_id)!;
      const t = { id: nextId++, client_key: null, description: "", tags: [], git_reference: "", notes: "", milestone_id: null, start_date: null, due_date: null, depends_on: [], sort_order: nextId * 1024,
        created_at: "", updated_at: "", completed_at: null, project_slug: p?.slug ?? null, project_title: p?.title ?? null, milestone_title: null, ...body };
      state.tasks.push(t);
      return json(t, 201);
    }
    if ((m = path.match(/^\/tasks\/(\d+)$/)) && method === "PATCH") {
      const t = state.tasks.find((x) => x.id === Number(m![1]))!;
      Object.assign(t, body);
      return json(t);
    }
    if (path === "/experiments" && method === "GET") return json(page(state.experiments));
    if (path === "/experiments" && method === "POST") {
      const p = state.projects.find((x) => x.id === body!.project_id)!;
      const e = { id: nextId++, experiment_key: "k", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        run_count: 0, metric_names: [], metric_summary: {}, runs_needing_review: 0, project_slug: p.slug, project_title: p.title, runs: [], ...body };
      state.experiments.push(e);
      return json(e, 201);
    }
    if ((m = path.match(/^\/experiments\/(\d+)$/))) return json(state.experiments.find((e) => e.id === Number(m![1])));
    if (path === "/dashboard/summary") return json({ active_projects: state.projects.length, open_tasks: state.tasks.length, running_experiments: 0,
      upcoming_deadlines: 0, blocked_projects: 0, overdue_tasks: 0, experiments_needing_review: 0, milestones_completed_last_7d: 0 });
    if (path === "/dashboard/deadlines") {
      if (!(q.get("kinds") ?? "task").split(",").includes("task")) return json([]);
      const items = state.tasks.filter((t) => t.due_date).map((t) => ({
        kind: "task", id: t.id, title: t.title, due_date: t.due_date, status: t.status ?? "todo", priority: t.priority ?? "medium",
        project_id: t.project_id, project_slug: t.project_slug, project_title: t.project_title,
        overdue: String(t.due_date) < todayISO(), days_left: 1,
      }));
      return json(items);
    }
    if (path === "/dashboard/activity") return json(page([]));
    if (path === "/dashboard/needs-review") return json([]);
    if (path === "/tokens") return json([]);
    return json(method === "GET" ? page([]) : {});
  });
  return state;
}
