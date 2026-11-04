import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import App from "@/App";
import { installFakeApi, makeProject } from "./fakeApi";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
function setup(archived = false) {
  const projects = [makeProject({ id: 7, slug: "study", title: "Study", archived })];
  const tasks = Array.from({ length: 231 }, (_, i) => ({ id: i + 1, project_id: 7, project_slug: "study", project_title: "Study", title: `Task ${i + 1}`, description: "", status: "todo", priority: "medium", start_date: "2026-11-01", due_date: "2026-11-05", depends_on: [], tags: [] }));
  const experiments = Array.from({ length: 231 }, (_, i) => ({ id: i + 1, project_id: 7, project_slug: "study", project_title: "Study", name: `Experiment ${i + 1}`, experiment_key: `exp-${i}`, group_name: "", type: "main", status: "planned", run_count: 0, runs_needing_review: 0, metric_names: [], metric_summary: {}, updated_at: "2026-11-01T00:00:00Z" }));
  installFakeApi({ projects, tasks, experiments });
  const base = globalThis.fetch;
  const requests: URL[] = [];
  vi.stubGlobal("fetch", async (input: string, options?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    requests.push(url);
    const path = url.pathname;
    if (path.endsWith("/dashboard/activity") || path.endsWith("/7/progress")) {
      const events = Array.from({ length: 231 }, (_, i) => ({ id: i + 1, project_id: 7, project_slug: "study", project_title: "Study", related_resource_type: "project", related_resource_id: 7, event_type: "progress_note", summary: `Event ${i + 1}`, details: "", source: "manual", actor: "user", created_at: "2026-11-01T00:00:00Z" }));
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return Response.json({ items: events.slice(offset, offset + limit), total: events.length, offset, limit });
    }
    const response = await base(input, options);
    if (path.endsWith("/tasks") || path.endsWith("/experiments")) {
      const data = await response.json();
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const items = archived && url.searchParams.get("include_archived") !== "true" ? [] : data.items;
      return Response.json({ items: items.slice(offset, offset + limit), total: items.length, offset, limit });
    }
    return response;
  });
  return requests;
}
function show(path: string) {
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} initialPath={path} />);
}

describe("collection screens", () => {
  it.each([
    ["/tasks", "Task 231"], ["/experiments", "Experiment 231"], ["/timeline", "Task 231"],
    ["/projects/study?tab=tasks", "Task 231"], ["/projects/study?tab=experiments", "Experiment 231"],
  ])("shows records beyond the server page cap at %s", async (path, title) => {
    setup(); show(path);
    expect((await screen.findAllByText(title))[0]).toBeInTheDocument();
  });
  it.each([
    ["tasks", "Task 231"], ["experiments", "Experiment 231"], ["gantt", "Task 231"],
  ])("shows archived project %s without changing its archived state", async (tab, title) => {
    const requests = setup(true); show(`/projects/study?tab=${tab}`);
    expect((await screen.findAllByText(title))[0]).toBeInTheDocument();
    if (tab === "gantt") expect(requests.find((url) => url.pathname.endsWith("/dashboard/deadlines"))?.searchParams.get("include_archived")).toBe("true");
  });
  it.each(["/activity", "/projects/study?tab=activity"])("loads activity beyond 200 at %s", async (path) => {
    const requests = setup(true); show(path);
    const user = userEvent.setup();
    await screen.findByText("Event 1");
    for (let i = 0; i < 4; i++) {
      await user.click(await screen.findByRole("button", { name: /Load more/ }));
      await screen.findByText(`Event ${Math.min(231, (i + 2) * 50)}`);
    }
    expect(screen.getByText("Event 231")).toBeInTheDocument();
    expect(requests.filter((url) => url.searchParams.has("limit")).every((url) => Number(url.searchParams.get("limit")) <= 200)).toBe(true);
  });
  it.each([
    ["/activity", "Since", "Until", "since", "until", "/dashboard/activity"],
    ["/experiments", "Created after", "Created before", "created_after", "created_before", "/experiments"],
  ])("uses complete local calendar days for %s timestamp filters", async (path, startLabel, endLabel, startParam, endParam, endpoint) => {
    const requests = setup(); show(path);
    fireEvent.change(await screen.findByLabelText(startLabel), { target: { value: "2026-03-08" } });
    fireEvent.change(screen.getByLabelText(endLabel), { target: { value: "2026-03-08" } });
    await waitFor(() => {
      const request = [...requests].reverse().find((url) => url.pathname.endsWith(endpoint) && url.searchParams.has(endParam));
      const start = new Date(2026, 2, 8).toISOString();
      const end = new Date(new Date(2026, 2, 9).getTime() - 1).toISOString().replace(".999Z", ".999999Z");
      expect(request?.searchParams.get(startParam)).toBe(start);
      expect(request?.searchParams.get(endParam)).toBe(end);
    });
  });
});
