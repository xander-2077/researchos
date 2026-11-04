import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import App from "@/App";
import { api } from "@/services/api";
import type { ActivityEvent } from "@/types/api";
import { installFakeApi } from "./fakeApi";

const event: ActivityEvent = {
  id: 42, project_id: null, related_resource_type: "task", related_resource_id: 1,
  event_type: "task_created", summary: "Task created: Test task", details: "",
  source: "manual", actor: "admin", created_at: "2026-11-04T00:00:00Z",
  project_slug: null, project_title: null,
};
const page = (items: ActivityEvent[]) => ({ items, total: items.length, limit: 50, offset: 0 });
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(<App client={client} initialPath="/activity" />);
}
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("lets administrators delete activity and restore it from the deleted list", async () => {
  installFakeApi();
  let deleted = false;
  vi.spyOn(api, "activity").mockImplementation(async (q) => page(Boolean(q?.deleted) === deleted
    ? [{ ...event, deleted_at: deleted ? "2026-11-04T01:00:00Z" : null }] : []));
  const remove = vi.spyOn(api, "deleteActivity").mockImplementation(async () => { deleted = true; });
  const restore = vi.spyOn(api, "restoreActivity").mockImplementation(async () => { deleted = false; });
  renderApp();
  await userEvent.click(await screen.findByRole("button", { name: "Delete activity" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(42));
  await screen.findByText("No matching activity");
  await userEvent.click(screen.getByRole("button", { name: "Deleted activity" }));
  await userEvent.click(await screen.findByRole("button", { name: "Restore activity" }));
  await waitFor(() => expect(restore).toHaveBeenCalledWith(42));
  await screen.findByText("No matching activity");
  await userEvent.click(screen.getByRole("button", { name: "Back to activity" }));
  expect(await screen.findByText(event.summary)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Delete activity" }));
  await screen.findByText("No matching activity");
  const undoButtons = await screen.findAllByRole("button", { name: "Undo" });
  fireEvent.click(undoButtons.at(-1)!);
  expect(await screen.findByText(event.summary)).toBeInTheDocument();
});

it("hides deletion and recovery controls from regular members", async () => {
  installFakeApi({ isAdmin: false });
  vi.spyOn(api, "activity").mockResolvedValue(page([event]));
  renderApp();
  await screen.findByText(event.summary);
  expect(screen.queryByRole("button", { name: "Delete activity" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Deleted activity" })).not.toBeInTheDocument();
});
