import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import App from "@/App";
import { api } from "@/services/api";
import type { ActivityEvent } from "@/types/api";
import { installFakeApi } from "./fakeApi";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("nests membership and progress events under separate project branches", async () => {
  installFakeApi({ isAdmin: false });
  const base: ActivityEvent = {
    id: 1, project_id: 7, project_slug: "bob-project", project_title: "Bob project",
    related_resource_type: "", related_resource_id: null, event_type: "member_added",
    summary: "Member added: alice", details: "", actor: "bob", source: "manual", created_at: "2026-11-04T00:00:00Z",
  };
  const events = [base,
    { ...base, id: 2, project_id: 8, project_slug: "alice-project", project_title: "Alice project", event_type: "progress_note", summary: "Alice progress" },
    { ...base, id: 3, event_type: "progress_note", summary: "Bob progress" },
    { ...base, id: 4, project_id: null, project_slug: null, project_title: null, event_type: "task_created", summary: "My personal task" },
  ];
  vi.spyOn(api, "activity").mockResolvedValue({ items: events, total: 4, limit: 50, offset: 0 });
  render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} initialPath="/activity" />);
  const bob = within(await screen.findByRole("region", { name: "Bob project" }));
  expect(bob.getByRole("link", { name: "Bob project" })).toHaveAttribute("href", "/projects/bob-project");
  expect(bob.getByText("Member added: alice")).toBeInTheDocument();
  expect(bob.getByText("Bob progress")).toBeInTheDocument();
  expect(bob.queryByText("Alice progress")).not.toBeInTheDocument();
  expect(bob.getAllByText("bob")).toHaveLength(2);
  expect(within(screen.getByRole("region", { name: "Alice project" })).getByText("Alice progress")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Personal tasks" })).getByText("My personal task")).toBeInTheDocument();
});
