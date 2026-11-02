import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import App from "@/App";
import { todayISO } from "@/lib/utils";
import { installFakeApi, makeProject, type FakeState } from "./fakeApi";

function renderApp(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(<App client={client} initialPath={path} />);
}

let state: FakeState;

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => vi.unstubAllGlobals());

describe("authentication", () => {
  it("shows login form and signs in", async () => {
    state = installFakeApi({ authenticated: false, projects: [makeProject({ id: 1, title: "Quadruped Soccer" })] });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid username or password")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Quadruped Soccer")).toBeInTheDocument();
  });
});

describe("portfolio", () => {
  it("shows multiple projects with stage, health, progress and blockers", async () => {
    state = installFakeApi({
      projects: [
        makeProject({ id: 1, title: "Humanoid WBM", stage: "experimentation", milestone_progress: { completed: 1, total: 4, percent: 25 } }),
        makeProject({ id: 2, title: "Quadruped Soccer", stage: "analysis", health_status: "at_risk", blocker_summary: "Cluster quota exhausted" }),
        makeProject({ id: 3, title: "Data Generation", stage: "research_design" }),
      ],
    });
    renderApp();
    const cards = await screen.findAllByTestId("project-card");
    expect(cards).toHaveLength(3);
    const soccer = cards.find((c) => within(c).queryByText("Quadruped Soccer"))!;
    expect(within(soccer).getByText("Analysis")).toBeInTheDocument();
    expect(within(soccer).getByText("At Risk")).toBeInTheDocument();
    expect(within(soccer).getByText("Cluster quota exhausted")).toBeInTheDocument();
    const wbm = cards.find((c) => within(c).queryByText("Humanoid WBM"))!;
    expect(within(wbm).getByText("1/4 · 25%")).toBeInTheDocument();
    const data = cards.find((c) => within(c).queryByText("Data Generation"))!;
    expect(within(data).getByText("Not set")).toBeInTheDocument(); // no fake percentage
    // table view
    await userEvent.click(screen.getByRole("radio", { name: /Table/ }));
    expect(await screen.findByRole("columnheader", { name: /Project/ })).toBeInTheDocument();
  });

  it("filters by stage via the API", async () => {
    state = installFakeApi({ projects: [makeProject({ title: "A", stage: "writing" }), makeProject({ title: "B", stage: "ideation" })] });
    renderApp();
    await screen.findAllByTestId("project-card");
    await userEvent.selectOptions(screen.getByLabelText("Filter by stage"), "writing");
    await waitFor(() => expect(screen.getAllByTestId("project-card")).toHaveLength(1));
    expect(state.calls.some((c) => c.path === "/projects" && c.method === "GET")).toBe(true);
  });
});

describe("create and edit", () => {
  it("creates a project with validation and CSRF header", async () => {
    state = installFakeApi();
    renderApp("/projects");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(await within(dialog).findByText("Title is required")).toBeInTheDocument();
    expect(state.calls.find((c) => c.method === "POST" && c.path === "/projects")).toBeUndefined();

    await user.type(within(dialog).getByLabelText(/Title/), "Multi-Agent Quadruped Soccer");
    await user.selectOptions(within(dialog).getByLabelText("Stage"), "implementation");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(state.projects).toHaveLength(1));
    const post = state.calls.find((c) => c.method === "POST" && c.path === "/projects")!;
    expect(post.body).toMatchObject({ title: "Multi-Agent Quadruped Soccer", stage: "implementation" });
    expect(post.headers["X-CSRF-Token"]).toBe("csrf-1");
    // navigates to the new project's detail page
    expect(await screen.findByRole("heading", { name: "Multi-Agent Quadruped Soccer" })).toBeInTheDocument();
  });

  it("changes the research stage from the project page", async () => {
    state = installFakeApi({ projects: [makeProject({ id: 7, title: "Humanoid WBM", stage: "implementation" })] });
    renderApp("/projects/humanoid-wbm");
    const select = await screen.findByLabelText("Research stage");
    await userEvent.selectOptions(select, "experimentation");
    await waitFor(() => {
      const patch = state.calls.find((c) => c.method === "PATCH" && c.path === "/projects/7");
      expect(patch?.body).toEqual({ stage: "experimentation", version: 1 });
    });
    await waitFor(() => expect((screen.getByLabelText("Research stage") as HTMLSelectElement).value).toBe("experimentation"));
  });

  it("creates a task in a project", async () => {
    state = installFakeApi({ projects: [makeProject({ id: 3, title: "Quadruped Soccer" })] });
    renderApp("/projects/quadruped-soccer?tab=tasks");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Task" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Title/), "Run no-world-model ablation");
    await user.selectOptions(within(dialog).getByLabelText("Priority"), "high");
    await user.type(within(dialog).getByLabelText("Deadline"), todayISO(3));
    await user.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(state.tasks).toHaveLength(1));
    expect(state.tasks[0]).toMatchObject({ project_id: 3, title: "Run no-world-model ablation", priority: "high", due_date: todayISO(3) });
    expect(await screen.findByText("Run no-world-model ablation")).toBeInTheDocument();
  });

  it("adds an experiment", async () => {
    state = installFakeApi({ projects: [makeProject({ id: 4, title: "Quadruped Soccer" })] });
    renderApp("/experiments");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Experiment" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Project/), "4");
    await user.type(within(dialog).getByLabelText(/Name/), "Ablation: no world model");
    await user.type(within(dialog).getByLabelText(/Group/), "World-model ablations");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "ablation");
    await user.click(within(dialog).getByRole("button", { name: "Create experiment" }));
    await waitFor(() => expect(state.experiments).toHaveLength(1));
    expect(state.experiments[0]).toMatchObject({ project_id: 4, name: "Ablation: no world model", group_name: "World-model ablations", type: "ablation" });
    expect(await screen.findByRole("heading", { name: "Ablation: no world model" })).toBeInTheDocument();
  });
});

describe("timeline", () => {
  it("lists cross-project deadlines", async () => {
    const a = makeProject({ id: 1, title: "Humanoid WBM" });
    const b = makeProject({ id: 2, title: "Quadruped Soccer" });
    state = installFakeApi({
      projects: [a, b],
      tasks: [
        { id: 11, project_id: 1, project_slug: a.slug, project_title: "Humanoid WBM", title: "Sim ablation", due_date: todayISO(2), status: "todo", priority: "high", tags: [] },
        { id: 12, project_id: 2, project_slug: b.slug, project_title: "Quadruped Soccer", title: "Write method", due_date: todayISO(5), status: "todo", priority: "medium", tags: [] },
      ],
    });
    renderApp("/timeline");
    expect(await screen.findByText("Sim ablation")).toBeInTheDocument();
    expect(screen.getByText("Write method")).toBeInTheDocument();
    expect(screen.getAllByText("Humanoid WBM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quadruped Soccer").length).toBeGreaterThan(0);
    expect(state.calls.some((c) => c.path === "/dashboard/deadlines")).toBe(true);
  });
});

describe("i18n", () => {
  it("switches the UI to Simplified Chinese and remembers it", async () => {
    state = installFakeApi({
      authenticated: false,
      projects: [makeProject({ id: 1, title: "Quadruped Soccer", stage: "analysis", health_status: "at_risk" })],
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "简体中文" }));
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(localStorage.getItem("researchos-lang")).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    await user.type(screen.getByLabelText("密码"), "correct-horse-1");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("进行中项目")).toBeInTheDocument();
    const card = await screen.findByTestId("project-card");
    expect(within(card).getByText("分析")).toBeInTheDocument(); // stage enum
    expect(within(card).getByText("有风险")).toBeInTheDocument(); // health enum
    expect(within(card).getByText("未设置")).toBeInTheDocument(); // no milestones
    expect(screen.getByRole("link", { name: "项目" })).toBeInTheDocument(); // sidebar nav
    // (kept last in this file: the language choice persists for the rest of the module)
  });
});
