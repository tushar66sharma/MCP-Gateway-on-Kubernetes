import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import type { RouteHandle } from './components/layout/TopBar';
import { RequireAuth, RequireRole } from './lib/auth';
import { Audit } from './pages/Audit';
import { Chat } from './pages/Chat';
import { Keys } from './pages/Keys';
import { AcceptInvite } from './pages/AcceptInvite';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { ServerDetail } from './pages/ServerDetail';
import { Servers } from './pages/Servers';
import { Team } from './pages/Team';
import { NotFound, RouteError } from './pages/NotFound';

const handle = (title: string): RouteHandle => ({ title });

export const routes: RouteObject[] = [
  { path: '/login', element: <Login />, errorElement: <RouteError /> },
  { path: '/invite/:token', element: <AcceptInvite />, errorElement: <RouteError /> },
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
        element: <Keys />,
      },
      {
        path: 'audit',
        handle: handle('Audit log'),
        element: <Audit />,
      },
      {
        path: 'chat',
        handle: handle('Chat'),
        element: <Chat />,
      },
      {
        path: 'team',
        handle: handle('Team'),
        element: (
          <RequireRole role="admin">
            <Team />
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
