import { lazy, type ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { AgentsPage } from './pages/AgentsPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ContactDetailPage } from './pages/ContactDetailPage';
import { ContactsPage } from './pages/ContactsPage';
import { LoginPage } from './pages/LoginPage';
import { PipelinePage } from './pages/PipelinePage';
import { PromptDetailPage } from './pages/PromptDetailPage';
import { PromptsPage } from './pages/PromptsPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { RunsPage } from './pages/RunsPage';

// The dashboard pulls in the charting library; load it only when opened.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/contacts" replace />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route
          path="ops"
          element={
            <Suspense fallback={<Loading />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="prompts"
          element={
            <RequireAdmin>
              <PromptsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="prompts/:name"
          element={
            <RequireAdmin>
              <PromptDetailPage />
            </RequireAdmin>
          }
        />
        <Route
          path="agents"
          element={
            <RequireAdmin>
              <AgentsPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/contacts" replace />} />
      </Route>
    </Routes>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking)
    return (
      <div className="grid min-h-screen place-items-center">
        <Loading label="Checking your session…" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 text-sm text-muted">
        Only admins can manage prompts, agents and routing. Sign in as an admin to continue.
      </div>
    );
  }
  return <>{children}</>;
}
