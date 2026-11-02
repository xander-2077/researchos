import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorState, Spinner } from "@/components/ui/misc";
import { AppStateProvider, useAppState } from "@/hooks/app-state";
import { AuthProvider, useAuth } from "@/hooks/auth";
import ActivityPage from "@/pages/Activity";
import ExperimentsPage, { ExperimentDetailPage } from "@/pages/Experiments";
import LoginPage from "@/pages/Login";
import OverviewPage from "@/pages/Overview";
import ProjectDetailPage from "@/pages/ProjectDetail";
import ProjectsPage from "@/pages/Projects";
import SettingsPage from "@/pages/Settings";
import TasksPage from "@/pages/Tasks";
import TimelinePage from "@/pages/Timeline";
import { ApiError } from "@/services/api";
import { EmptyState } from "@/components/ui/misc";
import { Link } from "react-router-dom";

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
  return <EmptyState title="Page not found" action={<Link to="/" className="text-primary hover:underline">Go to overview</Link>} />;
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
      <AppStateProvider>
        <AuthProvider>{children}</AuthProvider>
      </AppStateProvider>
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
