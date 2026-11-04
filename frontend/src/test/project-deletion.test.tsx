import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import App from "@/App";
import { api } from "@/services/api";
import { installFakeApi, makeProject } from "./fakeApi";

function renderProject() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  render(<App client={client} initialPath="/projects/my-project" />);
}
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("lets the creator confirm permanent deletion and returns to the project list", async () => {
  const state = installFakeApi({ isAdmin: false, projects: [makeProject({ id: 1, title: "My project", owner_id: 1 })] });
  localStorage.setItem("researchos-project-filter", "1");
  const remove = vi.spyOn(api, "deleteProject").mockImplementation(async () => { state.projects = []; });
  renderProject();
  await userEvent.click(await screen.findByRole("button", { name: "Delete project" }));
  let dialog = await screen.findByRole("dialog", { name: "Delete project?" });
  expect(within(dialog).getByText(/This cannot be undone/)).toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete project" }));
  dialog = await screen.findByRole("dialog", { name: "Delete project?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(1));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "My project" })).not.toBeInTheDocument());
  expect(localStorage.getItem("researchos-project-filter")).toBe("");
});

it.each([false, true])("hides permanent deletion from a nonowner (admin=%s)", async (isAdmin) => {
  installFakeApi({ isAdmin, projects: [makeProject({ id: 1, title: "My project", owner_id: 2 })] });
  renderProject();
  await screen.findByRole("heading", { name: "My project" });
  expect(screen.queryByRole("button", { name: "Delete project" })).not.toBeInTheDocument();
});
