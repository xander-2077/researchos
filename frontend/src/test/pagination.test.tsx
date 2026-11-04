import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as hooks from "@/hooks/queries";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, wrap: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
afterEach(() => vi.unstubAllGlobals());

// Real query hooks and fetch wrapper against the server's bounded-page contract.
function pagedServer() {
  const requests: URL[] = [];
  let failOffset: number | undefined;
  let revision = 0;
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input, "http://localhost");
    requests.push(url);
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (offset === failOffset) return Response.json({ error: { message: "Page unavailable" } }, { status: 503 });
    const total = url.searchParams.get("q") === "filtered" ? 1 : 231;
    const items = Array.from({ length: total }, (_, i) => ({ id: i + 1, title: `Item ${i + 1}`, revision })).slice(offset, offset + limit);
    return Response.json({ items, total, limit, offset });
  });
  return { requests, fail: (offset?: number) => { failOffset = offset; }, revise: () => { revision++; } };
}

describe("complete collection queries", () => {
  it.each([
    ["tasks", () => hooks.useAllTasks({ include_archived: true, project_id: 7 })],
    ["experiments", () => hooks.useAllExperiments({ include_archived: true, project_id: 7 })],
    ["projects", () => hooks.useAllProjects({ include_all: true })],
  ] as const)("loads every %s page with bounded requests", async (kind, useCollection) => {
    const server = pagedServer();
    const { wrap } = wrapper();
    const { result } = renderHook(() => {
      const query = useCollection();
      return { isSuccess: query.isSuccess, data: query.data as { items: { id: number }[] } | undefined };
    }, { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(231);
    expect(result.current.data?.items.at(-1)?.id).toBe(231);
    expect(server.requests.length).toBeGreaterThan(1);
    for (const url of server.requests) {
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(200);
      if (kind !== "projects") expect(url.searchParams.get("include_archived")).toBe("true");
    }
  });

  it("reports later-page failure and retries the whole collection, including after invalidation", async () => {
    const server = pagedServer();
    server.fail(100);
    const { wrap, client } = wrapper();
    const { result } = renderHook(() => hooks.useAllTasks(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    server.fail();
    await act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data?.items).toHaveLength(231));
    server.revise();
    await act(() => client.invalidateQueries({ queryKey: ["tasks"] }));
    await waitFor(() => expect(result.current.data?.items.at(-1)).toMatchObject({ revision: 1 }));
  });
});

describe("activity pagination", () => {
  it("keeps loaded activity after a later-page error and can retry that page", async () => {
    const server = pagedServer();
    const { wrap } = wrapper();
    const { result } = renderHook(() => hooks.useActivityPages(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(50));
    server.fail(50);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.data?.items).toHaveLength(50);
    server.fail();
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.items).toHaveLength(100));
    expect(result.current.data?.items.at(-1)?.id).toBe(100);
  });
  it.each(["global", "project"])("can reach %s activity past 200 and resets filters", async (kind) => {
    const server = pagedServer();
    const { wrap } = wrapper();
    const { result, rerender } = renderHook(({ q }) => kind === "global"
      ? hooks.useActivityPages({ q }) : hooks.useProgressPages(7, { q }), { wrapper: wrap, initialProps: { q: "" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    while (result.current.hasNextPage) await act(() => result.current.fetchNextPage());
    expect(result.current.data?.items).toHaveLength(231);
    expect(new Set(result.current.data?.items.map((x) => x.id)).size).toBe(231);
    expect(server.requests.every((url) => Number(url.searchParams.get("limit")) <= 200)).toBe(true);
    rerender({ q: "filtered" });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(false);
    expect(server.requests.at(-1)?.searchParams.get("offset")).toBe("0");
  });
});
