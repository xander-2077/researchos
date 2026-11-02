import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, BookOpen, CalendarRange, ChevronsLeft, ChevronsRight, FlaskConical, FolderKanban, LayoutDashboard, ListTodo,
  Languages, LogOut, Menu, Monitor, Moon, NotebookPen, Plus, Search, Settings, Sun, UserRound, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlay";
import { Kbd, Spinner } from "@/components/ui/misc";
import { ProjectIcon } from "@/components/icons/project-icons";
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

const BOTTOM = new Set(["/settings", "/help"]);

function NavItem({ to, label: l, icon: Icon, end, collapsed, onClose }: (typeof NAV)[number] & { collapsed: boolean; onClose: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      title={collapsed ? t(l) : undefined}
      className={({ isActive }) =>
        cn(
          "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          isActive && "bg-primary/9 font-medium text-primary hover:bg-primary/12 hover:text-primary",
          collapsed && "md:justify-center md:px-0",
        )
      }
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.7} />
      <span className={cn(collapsed && "md:hidden")}>{t(l)}</span>
    </NavLink>
  );
}

/** Plane-style project list in the sidebar (manual order, with each project's icon). */
function SidebarProjects({ collapsed, onClose }: { collapsed: boolean; onClose: () => void }) {
  const { data } = useProjects({ sort: "manual", limit: 200 });
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-0.5" aria-label={t("Projects")}>
      <div className={cn("px-2.5 pb-1 text-[11px] font-medium text-muted-foreground", collapsed && "md:hidden")}>{t("Projects")}</div>
      {items.slice(0, 15).map((p) => (
        <NavLink key={p.id} to={`/projects/${p.slug}`} onClick={onClose} title={p.title}
          className={({ isActive }) => cn(
            "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            isActive && "bg-accent font-medium text-foreground",
            collapsed && "md:justify-center md:px-0",
          )}>
          <ProjectIcon icon={p.icon} color={p.color} size="xs" />
          <span className={cn("truncate", collapsed && "md:hidden")}>{p.title}</span>
        </NavLink>
      ))}
    </div>
  );
}

function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { sidebarCollapsed: collapsed, toggleSidebar } = useAppState();
  const { me, logout } = useAuth();
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width,transform] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0",
          collapsed ? "md:w-14" : "md:w-[232px]",
          "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4", collapsed && "md:justify-center md:px-0")}>
          <img src="/favicon.svg" alt="" className="size-7 shrink-0" />
          <div className={cn("min-w-0 text-[14px] font-semibold tracking-tight", collapsed && "md:hidden")}>ResearchOS</div>
          <Button variant="ghost" size="icon-sm" className="ml-auto md:hidden" onClick={onClose} aria-label="Close menu"><X /></Button>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-3 pt-3">
          {NAV.filter((n) => !BOTTOM.has(n.to)).map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClose={onClose} />)}
          <SidebarProjects collapsed={collapsed} onClose={onClose} />
          <div className="mt-auto flex flex-col gap-1 pt-2">
            {NAV.filter((n) => BOTTOM.has(n.to)).map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClose={onClose} />)}
          </div>
        </nav>
        <div className="shrink-0 border-t border-border p-2.5">
          <div className={cn("flex items-center gap-2", collapsed && "md:flex-col")}>
            <span aria-hidden className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground", collapsed && "md:hidden")}><UserRound className="size-3.5" /></span>
            <span className={cn("flex-1 truncate text-xs font-medium", collapsed && "md:hidden")}>{me?.username}</span>
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
    <div className="relative w-full max-w-[280px]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setOpen(false))}
        placeholder={t("Search…")}
        aria-label="Global search"
        className="h-8 w-full min-w-0 rounded-md border border-transparent bg-muted/70 pl-8 pr-10 text-xs transition-colors placeholder:text-muted-foreground focus:border-input focus:bg-card focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>⌘K</Kbd></span>
      {open && enabled && (
        <div className="fixed left-4 right-4 top-14 z-50 max-h-96 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-[0_8px_24px_rgb(0_0_0/0.12)] sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-[26rem]">
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
  const loc = useLocation();
  const section = loc.pathname.split("/")[1] ?? "";
  const title = TITLES[section] ? t(TITLES[section]) : "ResearchOS";
  const SectionIcon = NAV.find((item) => item.to === `/${section}`)?.icon ?? LayoutDashboard;
  useEffect(() => {
    document.title = `${title} · ResearchOS`;
  }, [title]);
  const showProjectFilter = ["tasks", "experiments", "timeline", "activity"].includes(section);
  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-background/95 px-3 backdrop-blur-sm md:gap-2 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu /></Button>
          <SectionIcon aria-hidden className="hidden size-4 shrink-0 text-muted-foreground sm:block" strokeWidth={1.7} />
          <h1 className="hidden truncate text-[13px] font-medium sm:block sm:min-w-24">
            <Link to={loc.pathname}>{title}</Link>
          </h1>
          <div className="flex min-w-0 flex-1 justify-end px-1 md:pr-3"><GlobalSearch /></div>
          {showProjectFilter && <ProjectFilter />}
          <NewMenu />
          <LanguageToggle />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1600px] min-w-0 flex-1 px-4 py-6 md:px-7 lg:py-7">
          <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CreateDialogHost />
    </div>
  );
}
