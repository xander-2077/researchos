import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import App from "@/App";
import { api } from "@/services/api";
import type { ManagedUser } from "@/types/api";
import { installFakeApi, makeProject } from "./fakeApi";

const alice: ManagedUser = { id: 2, username: "alice", is_admin: false, is_active: true, registered: false, created_at: "2026-11-04T00:00:00Z", last_login_at: null };
const page = <T,>(items: T[]) => ({ items, total: items.length, limit: 50, offset: 0 });
function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(<App client={client} initialPath={path} />);
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("lets administrators create a user and copy the registration link", async () => {
  installFakeApi();
  vi.spyOn(api, "users").mockResolvedValue(page([alice]));
  const create = vi.spyOn(api, "createUser").mockResolvedValue({ user: alice, invitation_path: "/register#invite=secret", expires_at: "2026-11-11T00:00:00Z" });
  renderApp("/settings");
  await userEvent.click(await screen.findByRole("button", { name: "New user" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText(/Username/), "alice");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create invitation" }));
  expect(await within(dialog).findByLabelText("Invitation link")).toHaveValue(`${window.location.origin}/register#invite=secret`);
  expect(create).toHaveBeenCalledWith("alice", false);
});

it("hides user management from regular members", async () => {
  installFakeApi({ isAdmin: false });
  const users = vi.spyOn(api, "users");
  renderApp("/settings");
  await screen.findByText("API & MCP tokens");
  expect(screen.queryByText("User management")).not.toBeInTheDocument();
  expect(users).not.toHaveBeenCalled();
});

it("adds a collaborator from the project members tab", async () => {
  installFakeApi({ projects: [makeProject({ id: 1, title: "Shared project", owner_id: 1 })] });
  vi.spyOn(api, "members").mockResolvedValue(page([{ user_id: 1, username: "admin", is_active: true, is_owner: true }]));
  const candidates = vi.spyOn(api, "memberCandidates").mockResolvedValue(page([{ user_id: 2, username: "alice" }]));
  const add = vi.spyOn(api, "addMember").mockImplementation(async () => { candidates.mockResolvedValue(page([])); });
  renderApp("/projects/shared-project?tab=members");
  const picker = await screen.findByLabelText("Username");
  await waitFor(() => expect(picker).toBeEnabled());
  await userEvent.click(picker);
  const option = await screen.findByRole("menuitem", { name: "alice" });
  expect(option.querySelector("svg")).toBeInTheDocument();
  await userEvent.click(option);
  await userEvent.click(screen.getByRole("button", { name: "Add member" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith(1, "alice"));
  await screen.findByText("No available users");
  expect(screen.getByLabelText("Username")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add member" })).toBeDisabled();
});

it("does not load member candidates for a regular collaborator", async () => {
  installFakeApi({ isAdmin: false, projects: [makeProject({ id: 1, title: "Shared project", owner_id: 99 })] });
  const candidates = vi.spyOn(api, "memberCandidates");
  renderApp("/projects/shared-project?tab=members");
  await screen.findByText("Project members");
  expect(candidates).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
});

it("lets a collaborator confirm leaving and returns to the project list", async () => {
  const state = installFakeApi({ isAdmin: false, projects: [makeProject({ id: 1, title: "Shared project", owner_id: 99 })] });
  localStorage.setItem("researchos-project-filter", "1");
  vi.spyOn(api, "members").mockResolvedValue(page([
    { user_id: 99, username: "owner", is_active: true, is_owner: true },
    { user_id: 1, username: "admin", is_active: true, is_owner: false },
  ]));
  const leave = vi.spyOn(api, "leaveProject").mockImplementation(async () => { state.projects = []; });
  renderApp("/projects/shared-project?tab=members");
  await userEvent.click(await screen.findByRole("button", { name: "Leave project" }));
  expect(leave).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("dialog", { name: "Leave project?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Leave project" }));
  await waitFor(() => expect(leave).toHaveBeenCalledWith(1));
  await waitFor(() => expect(screen.queryByText("Project members")).not.toBeInTheDocument());
  expect(localStorage.getItem("researchos-project-filter")).toBe("");
});

it("does not let the project owner leave", async () => {
  installFakeApi({ projects: [makeProject({ id: 1, title: "Owned project", owner_id: 1 })] });
  vi.spyOn(api, "members").mockResolvedValue(page([{ user_id: 1, username: "admin", is_active: true, is_owner: true }]));
  renderApp("/projects/owned-project?tab=members");
  await screen.findByText("Owner");
  expect(screen.queryByRole("button", { name: "Leave project" })).not.toBeInTheDocument();
});

it("validates repeated passwords and registers from a shared invitation link", async () => {
  const state = installFakeApi({ authenticated: false, isAdmin: false });
  vi.spyOn(api, "inspectInvitation").mockResolvedValue({ username: "alice", expires_at: "2026-11-11T00:00:00Z" });
  const register = vi.spyOn(api, "register").mockImplementation(async () => {
    state.authenticated = true;
    return { authenticated: true, username: "alice", user_id: 2, is_admin: false, csrf_token: "new-csrf" };
  });
  renderApp("/register#invite=secret");
  expect(await screen.findByLabelText("Username")).toHaveValue("alice");
  await userEvent.type(screen.getByLabelText("Password"), "long-password-123");
  await userEvent.type(screen.getByLabelText("Repeat password"), "different-password");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
  expect(register).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText("Repeat password"));
  await userEvent.type(screen.getByLabelText("Repeat password"), "long-password-123");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(register).toHaveBeenCalledWith("secret", "long-password-123"));
  expect(await screen.findByRole("button", { name: "Log out" })).toBeInTheDocument();
});

it("requires confirmation before deleting a user and refreshes the list", async () => {
  installFakeApi();
  const users = vi.spyOn(api, "users").mockResolvedValue(page([alice]));
  const del = vi.spyOn(api, "deleteUser").mockImplementation(async () => {
    users.mockResolvedValue(page([]));
  });
  renderApp("/settings");
  await userEvent.click(await screen.findByRole("button", { name: "Delete user" }));
  expect(del).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Projects and images will transfer to you/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete user" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith(2));
  await waitFor(() => expect(screen.queryByText("alice", { exact: true })).not.toBeInTheDocument());
});
