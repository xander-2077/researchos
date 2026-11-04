import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// ------------------------------------------------------------------ theme
export type Theme = "light" | "dark" | "system";
const THEME_KEY = "researchos-theme";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// ------------------------------------------------------------------ create dialogs
export type CreateKind = "project" | "task" | "milestone" | "experiment" | "progress";
export interface CreateRequest {
  kind: CreateKind;
  projectId?: number;
  defaults?: Record<string, unknown>;
}

/** Project filter value for "tasks and events that belong to no project" (API: project_id=0). */
export const NO_PROJECT = 0;

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Global project filter used by Tasks / Experiments / Timeline / Activity (null = all, NO_PROJECT = none). */
  projectFilter: number | null;
  setProjectFilter: (id: number | null) => void;
  create: CreateRequest | null;
  openCreate: (r: CreateRequest) => void;
  closeCreate: () => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (readStorage(THEME_KEY) as Theme) || "system");
  const [projectFilter, setProjectFilterState] = useState<number | null>(() => {
    const v = readStorage("researchos-project-filter");
    const n = v ? Number(v) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : null;
  });
  const [create, setCreate] = useState<CreateRequest | null>(null);
  const [sidebarCollapsed, setCollapsed] = useState(() => readStorage("researchos-sidebar") === "collapsed");

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme("system");
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    writeStorage(THEME_KEY, t);
    setThemeState(t);
  }, []);
  const setProjectFilter = useCallback((id: number | null) => {
    writeStorage("researchos-project-filter", id === null ? "" : String(id));
    setProjectFilterState(id);
  }, []);
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      writeStorage("researchos-sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      theme, setTheme, projectFilter, setProjectFilter, create,
      openCreate: setCreate, closeCreate: () => setCreate(null), sidebarCollapsed, toggleSidebar,
    }),
    [theme, setTheme, projectFilter, setProjectFilter, create, sidebarCollapsed, toggleSidebar],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside provider");
  return v;
}
