import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, BookOpen, CalendarRange, LifeBuoy, ChevronsLeft, ChevronsRight, FlaskConical, FolderKanban, LayoutDashboard, ListTodo,
  Languages, LogOut, Menu, Monitor, Moon, NotebookPen, Plus, Search, Settings, Sun, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlay";
import { Kbd, Spinner } from "@/components/ui/misc";
import { useAppState, type Theme } from "@/hooks/app-state";
import { useAuth } from "@/hooks/auth";
import { useProjects } from "@/hooks/queries";
import { api } from "@/services/api";
import { cn, label } from "@/lib/utils";
import { CreateDialogHost } from "@/features/CreateDialogHost";
import { LANGS, t, useI18n } from "@/i18n";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/timeline", label: "Timeline", icon: CalendarRange },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help", icon: BookOpen },
];

const TITLES: Record<string, string> = {
  "": "Portfolio Overview", projects: "Projects", experiments: "Experiment Registry", tasks: "Tasks",
  timeline: "Timeline & Deadlines", activity: "Activity", settings: "Settings", help: "Help",
};

function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { sidebarCollapsed: collapsed, toggleSidebar } = useAppState();
  const { me, logout } = useAuth();
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-sidebar transition-[width,transform] md:sticky md:top-0 md:h-screen md:translate-x-0",
          collapsed ? "md:w-[52px]" : "md:w-56",
          "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-12 items-center gap-2 px-3", collapsed && "md:justify-center md:px-0")}>
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className={cn("font-serif text-[17px] font-medium tracking-tight", collapsed && "md:hidden")}>ResearchOS</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto md:hidden" onClick={onClose} aria-label="Close menu"><X /></Button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
          {NAV.map(({ to, label: l, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              title={collapsed ? t(l) : undefined}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  isActive && "bg-accent text-foreground",
                  collapsed && "md:justify-center md:px-0",
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>{t(l)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-2">
          <div className={cn("flex items-center gap-2 px-1", collapsed && "md:flex-col")}>
            <span className={cn("flex-1 truncate text-xs text-muted-foreground", collapsed && "md:hidden")}>{me?.username}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => void logout()} aria-label={t("Log out")} title={t("Log out")}><LogOut /></Button>
            <Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" onClick={toggleSidebar} aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}>
              {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const term = q.trim();
  const enabled = term.length >= 2;
  const results = useQuery({
    queryKey: ["search", term],
    enabled,
    queryFn: async () => {
      const [p, t, e] = await Promise.all([
        api.projects({ q: term, include_all: true, limit: 5 }),
        api.tasks({ q: term, limit: 6 }),
        api.experiments({ q: term, limit: 5 }),
      ]);
      return { projects: p.items, tasks: t.items, experiments: e.items };
    },
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (to: string) => {
    setOpen(false);
    setQ("");
    navigate(to);
  };
  const r = results.data;
  const empty = r && !r.projects.length && !r.tasks.length && !r.experiments.length;
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setOpen(false))}
        placeholder={t("Search projects, tasks, experiments…")}
        aria-label="Global search"
        className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-12 text-[13px] placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>⌘K</Kbd></span>
      {open && enabled && (
        <div className="absolute left-0 right-0 top-10 z-50 max-h-96 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-[0_8px_24px_rgb(0_0_0/0.12)] sm:right-auto sm:w-[26rem]">
          {results.isLoading && <div className="flex justify-center p-4"><Spinner /></div>}
          {empty && <p className="p-3 text-center text-xs text-muted-foreground">{t("No results for “{term}”", { term })}</p>}
          {r?.projects.length ? <SearchGroup title={t("Projects")}>{r.projects.map((p) => <SearchItem key={p.id} onSelect={() => go(`/projects/${p.slug}`)} title={p.title} meta={label(p.stage)} />)}</SearchGroup> : null}
          {r?.tasks.length ? <SearchGroup title={t("Tasks")}>{r.tasks.map((t) => <SearchItem key={t.id} onSelect={() => go(`/projects/${t.project_slug}?tab=tasks`)} title={t.title} meta={`${t.project_title} · ${label(t.status)}`} />)}</SearchGroup> : null}
          {r?.experiments.length ? <SearchGroup title={t("Experiments")}>{r.experiments.map((e) => <SearchItem key={e.id} onSelect={() => go(`/experiments/${e.id}`)} title={e.name} meta={`${e.project_title} · ${label(e.status)}`} />)}</SearchGroup> : null}
        </div>
      )}
    </div>
  );
}

const SearchGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="py-1"><div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>{children}</div>
);
const SearchItem = ({ title, meta, onSelect }: { title: string; meta: string; onSelect: () => void }) => (
  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onSelect} className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent">
    <span className="truncate">{title}</span><span className="shrink-0 text-[11px] text-muted-foreground">{meta}</span>
  </button>
);

function ThemeToggle() {
  const { theme, setTheme } = useAppState();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("Theme")} title={t("Theme")}><Icon /></Button>
      </DropdownTrigger>
      <DropdownContent className="min-w-32">
        {(["light", "dark", "system"] as Theme[]).map((th) => (
          <DropdownItem key={th} onSelect={() => setTheme(th)} className={cn(theme === th && "font-semibold")}>
            {th === "light" ? <Sun /> : th === "dark" ? <Moon /> : <Monitor />}
            {t(th[0].toUpperCase() + th.slice(1))}
          </DropdownItem>
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("Language")} title={t("Language")}><Languages /></Button>
      </DropdownTrigger>
      <DropdownContent className="min-w-32">
        {LANGS.map((l) => (
          <DropdownItem key={l.value} onSelect={() => setLang(l.value)} className={cn(lang === l.value && "font-semibold")}>
            {l.label}
          </DropdownItem>
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

function ProjectFilter() {
  const { projectFilter, setProjectFilter } = useAppState();
  const { data } = useProjects({ limit: 200 });
  return (
    <Select
      aria-label="Project filter"
      className="hidden w-44 lg:block"
      value={projectFilter ?? ""}
      onChange={(e) => setProjectFilter(e.target.value ? Number(e.target.value) : null)}
      placeholder="All projects"
    >
      {data?.items.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
    </Select>
  );
}

function NewMenu() {
  const { openCreate, projectFilter } = useAppState();
  const pid = projectFilter ?? undefined;
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <Button size="default" aria-label={t("New")}><Plus /> <span className="hidden sm:inline">{t("New")}</span></Button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>{t("Create")}</DropdownLabel>
        <DropdownItem onSelect={() => openCreate({ kind: "project" })}><FolderKanban /> {t("Project")}</DropdownItem>
        <DropdownItem onSelect={() => openCreate({ kind: "task", projectId: pid })}><ListTodo /> {t("Task")}</DropdownItem>
        <DropdownItem onSelect={() => openCreate({ kind: "experiment", projectId: pid })}><FlaskConical /> {t("Experiment")}</DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => openCreate({ kind: "progress", projectId: pid })}><NotebookPen /> {t("Progress note")}</DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();
  const section = loc.pathname.split("/")[1] ?? "";
  const title = TITLES[section] ? t(TITLES[section]) : "ResearchOS";
  useEffect(() => {
    document.title = `${title} · ResearchOS`;
  }, [title]);
  const showProjectFilter = ["tasks", "experiments", "timeline", "activity"].includes(section);
  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu /></Button>
          <h1 className="hidden truncate font-serif text-[17px] font-medium sm:block sm:min-w-32">
            <Link to={loc.pathname}>{title}</Link>
          </h1>
          <div className="flex flex-1 justify-center px-2"><GlobalSearch /></div>
          {showProjectFilter && <ProjectFilter />}
          <NewMenu />
          <Button variant="ghost" size="icon" aria-label={t("Help")} title={t("Help")} onClick={() => navigate("/help")} className="hidden sm:inline-flex"><LifeBuoy /></Button>
          <LanguageToggle />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 md:px-6">
          <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CreateDialogHost />
    </div>
  );
}
