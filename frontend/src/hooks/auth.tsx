import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { api, setCsrfToken, setUnauthorizedHandler } from "@/services/api";
import type { Me } from "@/types/api";

interface AuthState {
  me: Me | undefined;
  loading: boolean;
  error: unknown;
  login: (u: string, p: string) => Promise<void>;
  register: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: Infinity, retry: 1, refetchInterval: false });

  useEffect(() => {
    setCsrfToken(q.data?.csrf_token ?? null);
  }, [q.data]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      void qc.cancelQueries();
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData<Me>(["me"], { authenticated: false });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const login = useCallback(
    async (u: string, p: string) => {
      const r = await api.login(u, p);
      await qc.cancelQueries();
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      setCsrfToken(r.csrf_token);
      qc.setQueryData<Me>(["me"], { ...r, authenticated: true });
    },
    [qc],
  );
  const register = useCallback(async (token: string, password: string) => {
    const r = await api.register(token, password);
    await qc.cancelQueries();
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    setCsrfToken(r.csrf_token);
    qc.setQueryData<Me>(["me"], { ...r, authenticated: true });
  }, [qc]);
  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setCsrfToken(null);
    // Do NOT use qc.clear(): it removes the "me" query that AuthProvider is subscribed to, so the
    // "signed out" state written afterwards would go to a new query nobody observes and the UI
    // would never leave the app. Drop only the research data and update "me" in place.
    await qc.cancelQueries();
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    qc.setQueryData<Me>(["me"], { authenticated: false });
  }, [qc]);

  const value = useMemo(() => ({ me: q.data, loading: q.isLoading, error: q.error, login, register, logout }), [q.data, q.isLoading, q.error, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}
