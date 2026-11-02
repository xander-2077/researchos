import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorState, Spinner } from "@/components/ui/misc";
import { AppStateProvider, useAppState } from "@/hooks/app-state";
import { AuthProvider, useAuth } from "@/hooks/auth";
import LoginPage from "@/pages/Login";
import { lazy } from "react";

// Route-level code splitting: each page is its own chunk.
const OverviewPage = lazy(() => import("@/pages/Overview"));
const ProjectsPage = lazy(() => import("@/pages/Projects"));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetail"));
const ExperimentsPage = lazy(() => import("@/pages/Experiments"));
const ExperimentDetailPage = lazy(() => import("@/pages/Experiments").then((m) => ({ default: m.ExperimentDetailPage })));
const TasksPage = lazy(() => import("@/pages/Tasks"));
const TimelinePage = lazy(() => import("@/pages/Timeline"));
const ActivityPage = lazy(() => import("@/pages/Activity"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const HelpPage = lazy(() => import("@/pages/Help"));
import { ApiError } from "@/services/api";
import { EmptyState } from "@/components/ui/misc";
import { Link } from "react-router-dom";
import { I18nProvider, t } from "@/i18n";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // Keep the UI in sync with writes from agents (MCP/REST) without manual reload.
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

function NotFound() {
  return <EmptyState title="Page not found" action={<Link to="/" className="text-primary hover:underline">{t("Go to overview")}</Link>} />;
}

function Gate() {
  const { me, loading, error } = useAuth();
  const { theme } = useAppState();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (error && !me) return <ErrorState error={error} onRetry={() => window.location.reload()} className="min-h-screen" />;
  return (
    <>
      {!me?.authenticated ? (
        <LoginPage setupRequired={me?.setup_required} />
      ) : (
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:ref" element={<ProjectDetailPage />} />
            <Route path="experiments" element={<ExperimentsPage />} />
            <Route path="experiments/:id" element={<ExperimentDetailPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="help/:doc" element={<HelpPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      )}
      <Toaster position="bottom-right" theme={theme} richColors closeButton />
    </>
  );
}

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <AppStateProvider>
          <AuthProvider>{children}</AuthProvider>
        </AppStateProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default function App({ client = makeQueryClient(), initialPath }: { client?: QueryClient; initialPath?: string }) {
  return (
    <Providers client={client}>
      {initialPath ? (
        <MemoryRouter initialEntries={[initialPath]}><Gate /></MemoryRouter>
      ) : (
        <BrowserRouter><Gate /></BrowserRouter>
      )}
    </Providers>
  );
}
