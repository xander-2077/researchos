import { render, screen, waitFor } from "@testing-library/react";
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

describe("gantt", () => {
  const seed = () => installFakeApi({
    projects: [makeProject({ id: 1, title: "Quadruped Soccer" })],
    tasks: [
      { id: 11, project_id: 1, project_slug: "quadruped-soccer", project_title: "Quadruped Soccer", title: "Run ablations", status: "in_progress", priority: "high", start_date: todayISO(1), due_date: todayISO(4), depends_on: [], tags: [] },
      { id: 12, project_id: 1, project_slug: "quadruped-soccer", project_title: "Quadruped Soccer", title: "Write results", status: "todo", priority: "medium", start_date: todayISO(2), due_date: todayISO(6), depends_on: [11], tags: [] },
      { id: 13, project_id: 1, project_slug: "quadruped-soccer", project_title: "Quadruped Soccer", title: "Unscheduled idea", status: "todo", priority: "low", start_date: null, due_date: null, depends_on: [], tags: [] },
    ],
  });

  it("draws bars, dependency arrows and flags a prerequisite violation", async () => {
    state = seed();
    renderApp("/timeline");
    const bar = await screen.findByRole("button", { name: /^Run ablations:/ });
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Write results:/ })).toBeInTheDocument();
    expect(screen.getAllByTestId("gantt-edge")).toHaveLength(1);
    // "Write results" starts (+2) before its prerequisite ends (+4) → warning ring
    expect(screen.getByRole("button", { name: /^Write results:/ }).className).toMatch(/ring-danger/);
    expect(bar.className).not.toMatch(/ring-danger/);
    expect(screen.getByRole("button", { name: "Set dates" })).toBeInTheDocument();
  });

  it("reschedules with the keyboard and saves both dates", async () => {
    state = seed();
    renderApp("/timeline");
    const user = userEvent.setup();
    const bar = await screen.findByRole("button", { name: /^Run ablations:/ });
    bar.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      const c = state.calls.find((x) => x.method === "PATCH" && x.path === "/tasks/11");
      expect(c?.body).toEqual({ start_date: todayISO(2), due_date: todayISO(5) });
    });
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() => {
      const calls = state.calls.filter((x) => x.method === "PATCH" && x.path === "/tasks/11");
      expect(calls.at(-1)?.body).toEqual({ start_date: todayISO(2), due_date: todayISO(4) });
    });
  });

  it("hides completed tasks on request and collapses projects", async () => {
    state = seed();
    state.tasks[0].status = "done";
    renderApp("/timeline");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /^Run ablations:/ });
    await user.click(screen.getByLabelText("Hide completed"));
    expect(screen.queryByRole("button", { name: /^Run ablations:/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByRole("button", { name: /^Write results:/ })).not.toBeInTheDocument();
  });
});
