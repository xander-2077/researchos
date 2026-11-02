import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/services/api";
import { t } from "@/i18n";

type Q = Record<string, string | number | boolean | null | undefined>;

export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: api.summary });
export const useProjects = (q: Q = {}) =>
  useQuery({ queryKey: ["projects", q], queryFn: () => api.projects(q), placeholderData: keepPreviousData });
export const useProject = (ref: string | number | undefined) =>
  useQuery({ queryKey: ["project", String(ref)], queryFn: () => api.project(ref!), enabled: ref !== undefined && ref !== "" });
export const useMilestones = (projectId: number | undefined) =>
  useQuery({ queryKey: ["milestones", projectId], queryFn: () => api.milestones(projectId!), enabled: !!projectId });
export const useTasks = (q: Q = {}) =>
  useQuery({ queryKey: ["tasks", q], queryFn: () => api.tasks(q), placeholderData: keepPreviousData });
export const useExperiments = (q: Q = {}) =>
  useQuery({ queryKey: ["experiments", q], queryFn: () => api.experiments(q), placeholderData: keepPreviousData });
export const useExperiment = (id: number | undefined) =>
  useQuery({ queryKey: ["experiment", id], queryFn: () => api.experiment(id!), enabled: !!id });
export const useActivity = (q: Q = {}) =>
  useQuery({ queryKey: ["activity", q], queryFn: () => api.activity(q), placeholderData: keepPreviousData });
export const useDeadlines = (q: Q = {}) =>
  useQuery({ queryKey: ["deadlines", q], queryFn: () => api.deadlines(q), placeholderData: keepPreviousData });
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
