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

describe("overview projects", () => {
  it("collapses and restores projects with the keyboard without changing data", async () => {
    state = installFakeApi({ projects: [makeProject({ id: 1, title: "Soccer" })] });
    renderApp();
    const user = userEvent.setup();
    const card = await screen.findByTestId("project-card");
    const toggle = screen.getByRole("button", { name: "Collapse projects" });
    expect(card).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(card).not.toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Upcoming Deadlines", { selector: "h3" })).toBeVisible();
    await user.keyboard(" ");
    expect(card).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(state.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });
});


describe("kanban ordering", () => {
  it("reorders cards inside a column from the keyboard and saves a fractional position", async () => {
    const p = makeProject({ id: 1, title: "Soccer" });
    const mk = (id: number, title: string, sort_order: number) => ({ id, project_id: 1, project_slug: p.slug, project_title: "Soccer", title, status: "todo", priority: "medium", tags: [], depends_on: [], sort_order, due_date: null, start_date: null });
    state = installFakeApi({ projects: [p], tasks: [mk(11, "First", 1024), mk(12, "Second", 2048), mk(13, "Third", 3072)] });
    localStorage.setItem("researchos-tasks-view", "kanban");
    renderApp("/tasks");
    const user = userEvent.setup();
    const col = await screen.findByTestId("kanban-todo");
    const order = () => within(col).getAllByText(/First|Second|Third/).map((e) => e.textContent);
    expect(order()).toEqual(["First", "Second", "Third"]);
    const third = within(col).getAllByRole("button", { name: "Drag to move" })[2];
    third.focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => {
      const c = state.calls.find((x) => x.method === "PATCH" && x.path === "/tasks/13");
      expect(c?.body).toEqual({ sort_order: 1536 }); // between First (1024) and Second (2048), status unchanged
    });
    await waitFor(() => expect(order()).toEqual(["First", "Third", "Second"]));
  });
});

describe("project page", () => {
  it("has a Gantt tab and an icon picker", async () => {
    const p = makeProject({ id: 1, title: "Soccer", slug: "soccer" });
    state = installFakeApi({ projects: [p], tasks: [
      { id: 21, project_id: 1, project_slug: "soccer", project_title: "Soccer", title: "Train policy", status: "in_progress", priority: "high", tags: [], depends_on: [], sort_order: 1, start_date: todayISO(0), due_date: todayISO(3) },
    ] });
    renderApp("/projects/soccer?tab=gantt");
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: /^Train policy:/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change icon" }));
    await user.click(screen.getByRole("button", { name: "Green" }));
    await waitFor(() => expect(state.calls.find((c) => c.method === "PATCH" && c.path === "/projects/1")?.body).toMatchObject({ icon: "folder-kanban", color: "#30a46c" }));
    // the picker stays open after choosing a colour, so the icon can be picked next
    await user.type(screen.getByLabelText("Search icons…"), "micro");
    expect(screen.queryByRole("button", { name: "bot" })).not.toBeInTheDocument(); // filtered
    await user.click(screen.getByRole("button", { name: "microscope" }));
    await waitFor(() => expect(state.calls.filter((c) => c.method === "PATCH" && c.path === "/projects/1").at(-1)?.body).toMatchObject({ icon: "microscope" }));
  });
});

