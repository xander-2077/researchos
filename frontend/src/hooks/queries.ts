import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/services/api";
import type { Page } from "@/types/api";
import { t } from "@/i18n";

type Q = Record<string, string | number | boolean | null | undefined>;

export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: api.summary });
export const useProjects = (q: Q = {}) =>
  useQuery({ queryKey: ["projects", q], queryFn: () => api.projects(q), placeholderData: keepPreviousData });
export const useProject = (ref: string | number | undefined) =>
  useQuery({ queryKey: ["project", String(ref)], queryFn: () => api.project(ref!), enabled: ref !== undefined && ref !== "" });
export const useMilestones = (projectId: number | undefined) =>
  useQuery({ queryKey: ["milestones", projectId], queryFn: () => api.milestones(projectId!), enabled: !!projectId });
export const useTasks = (q: Q = {}, opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: ["tasks", q], queryFn: () => api.tasks(q), placeholderData: keepPreviousData, enabled: opts.enabled ?? true });
export const useExperiments = (q: Q = {}) =>
  useQuery({ queryKey: ["experiments", q], queryFn: () => api.experiments(q), placeholderData: keepPreviousData });
export const useExperiment = (id: number | undefined) =>
  useQuery({ queryKey: ["experiment", id], queryFn: () => api.experiment(id!), enabled: !!id });
export const useActivity = (q: Q = {}) =>
  useQuery({ queryKey: ["activity", q], queryFn: () => api.activity(q), placeholderData: keepPreviousData });
export const useDeadlines = (q: Q = {}, enabled = true) =>
  useQuery({ queryKey: ["deadlines", q], queryFn: () => api.deadlines(q), placeholderData: keepPreviousData, enabled });
export const useNeedsReview = () => useQuery({ queryKey: ["needsReview"], queryFn: () => api.needsReview(8) });
export const useTokens = () => useQuery({ queryKey: ["tokens"], queryFn: api.tokens });

/** Mutation that toasts and refreshes all research data on success. */
export function useWrite<TVars, TRes>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes, v: TVars) => string); onSuccess?: (r: TRes, v: TVars) => void; extraKeys?: QueryKey[] } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (res, vars) => {
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(res, vars) : t(opts.success));
      opts.onSuccess?.(res, vars);
    },
    onError: (err) => {
      toast.error(t(err instanceof ApiError ? err.message : "Request failed"));
    },
  });
}

export const useProgressList = (projectId: number, q: Q = {}) =>
  useQuery({ queryKey: ["progress", projectId, q], queryFn: () => api.progress(projectId, q), placeholderData: keepPreviousData });

// Separate cache keys keep complete collections distinct from bounded previews.
export const useAllProjects = (q: Q = {}) =>
  useQuery({ queryKey: ["projects", "all", q], queryFn: ({ signal }) => api.allProjects(q, signal) });
export const useAllTasks = (q: Q = {}, opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: ["tasks", "all", q], queryFn: ({ signal }) => api.allTasks(q, signal), enabled: opts.enabled ?? true });
export const useAllExperiments = (q: Q = {}) =>
  useQuery({ queryKey: ["experiments", "all", q], queryFn: ({ signal }) => api.allExperiments(q, signal) });

function usePagedEvents<T extends { id: number }>(key: QueryKey, fetchPage: (q: Q) => Promise<Page<T>>, q: Q) {
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage({ ...q, limit: 50, offset: pageParam }),
    getNextPageParam: (last) => last.items.length && last.offset + last.items.length < last.total
      ? last.offset + last.items.length : undefined,
  });
  const pages = query.data?.pages;
  return {
    ...query,
    data: pages ? {
      items: [...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()],
      total: pages.at(-1)!.total,
    } : undefined,
  };
}
export const useActivityPages = (q: Q = {}) => usePagedEvents(["activity", "pages", q], api.activity, q);
export const useProgressPages = (projectId: number, q: Q = {}) =>
  usePagedEvents(["progress", projectId, "pages", q], (page) => api.progress(projectId, page), q);
