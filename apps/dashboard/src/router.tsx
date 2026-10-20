import { Hammer } from 'lucide-react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import type { RouteHandle } from './components/layout/TopBar';
import { BrandName } from './components/layout/BrandMark';
import { EmptyState } from './components/ui/EmptyState';
import { PageHeader } from './components/ui/PageHeader';
import { RequireAuth, RequireRole } from './lib/auth';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { ServerDetail } from './pages/ServerDetail';
import { Servers } from './pages/Servers';
import { NotFound, RouteError } from './pages/NotFound';

/*
 * TEMPORARY: pages that Tasks 4.4-4.6 build. Each renders its real header and an empty state until its
 * task replaces it; none may remain after Task 4.6.
 */
function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-card border border-border bg-surface">
        <EmptyState icon={<Hammer aria-hidden />} title="Coming in this phase" description="This page is being built in the current phase." />
      </div>
    </>
  );
}

function InvitePlaceholder() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-4 py-8 sm:px-10">
      <BrandName className="text-fg" />
      <main className="flex flex-1 items-center justify-center">
        <EmptyState icon={<Hammer aria-hidden />} title="Coming in this phase" description="Accepting an invite is being built in the current phase." />
      </main>
    </div>
  );
}

const handle = (title: string): RouteHandle => ({ title });

export const routes: RouteObject[] = [
  { path: '/login', element: <Login />, errorElement: <RouteError /> },
  { path: '/invite/:token', element: <InvitePlaceholder />, errorElement: <RouteError /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        handle: handle('Overview'),
        element: <Overview />,
      },
      {
        path: 'servers',
        handle: handle('Servers'),
        element: <Servers />,
      },
      {
        path: 'servers/:id',
        handle: handle('Server'),
        element: <ServerDetail />,
      },
      {
        path: 'keys',
        handle: handle('API keys'),
        element: <ComingSoon title="API keys" description="Keys that let MCP clients such as Claude Code and Cursor call tools as you." />,
      },
      {
        path: 'audit',
        handle: handle('Audit log'),
        element: <ComingSoon title="Audit log" description="Every tool call made through the gateway: who made it, and how it went." />,
      },
      {
        path: 'chat',
        handle: handle('Chat'),
        element: <ComingSoon title="Chat" description="Ask the assistant to use the gateway’s tools for you." />,
      },
      {
        path: 'team',
        handle: handle('Team'),
        element: (
          <RequireRole role="admin">
            <ComingSoon title="Team" description="Invite people, set their roles and manage their access." />
          </RequireRole>
        ),
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
