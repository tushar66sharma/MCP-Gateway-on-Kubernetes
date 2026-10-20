import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { apiFetch } from '../src/lib/api';
import { RequireAuth, RequireRole, useLogout, useMe } from '../src/lib/auth';
import { admin, errorResponse, jsonResponse, member, mockFetch, newQueryClient, Providers } from './helpers';

function LoginProbe() {
  const location = useLocation();
  return <p>login page at {`${location.pathname}${location.search}`}</p>;
}

function ServersProbe() {
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => apiFetch<unknown[]>('/api/servers') });
  return <p>{servers.isSuccess ? 'servers loaded' : 'servers loading'}</p>;
}

describe('auth', () => {
  it('401 redirects to login with next', async () => {
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(200, { user: admin }),
      'GET /api/servers': () => errorResponse(401, 'UNAUTHENTICATED', 'Session expired'),
    });
    const client = newQueryClient();
    client.setQueryData(['cached-elsewhere'], { secret: 'stale' });
    const router = createMemoryRouter(
      [
        { path: '/login', element: <LoginProbe /> },
        {
          path: '/servers',
          element: (
            <RequireAuth>
              <ServersProbe />
            </RequireAuth>
          ),
        },
      ],
      { initialEntries: ['/servers?status=down'] },
    );
    render(
      <Providers client={client}>
        <RouterProvider router={router} />
      </Providers>,
    );
    expect(await screen.findByText('login page at /login?next=%2Fservers%3Fstatus%3Ddown')).toBeInTheDocument();
    expect(client.getQueryData(['cached-elsewhere'])).toBeUndefined();
  });

  it('an anonymous visitor is sent to login with next', async () => {
    mockFetch({ 'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED') });
    const router = createMemoryRouter(
      [
        { path: '/login', element: <LoginProbe /> },
        { path: '/keys', element: <RequireAuth>keys page</RequireAuth> },
      ],
      { initialEntries: ['/keys'] },
    );
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );
    expect(await screen.findByText('login page at /login?next=%2Fkeys')).toBeInTheDocument();
    expect(screen.queryByText('keys page')).not.toBeInTheDocument();
  });

  it('shows a retryable error instead of the login page when the gateway is unreachable', async () => {
    let calls = 0;
    mockFetch({
      'GET /api/auth/me': () => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return jsonResponse(200, { user: admin });
      },
    });
    const router = createMemoryRouter([{ path: '/', element: <RequireAuth>overview page</RequireAuth> }]);
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('overview page')).toBeInTheDocument();
  });

  it('logout treats 401 as success', async () => {
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(200, { user: admin }),
      'POST /api/auth/logout': () => errorResponse(401, 'UNAUTHENTICATED'),
    });
    const client = newQueryClient();
    let outcome = 'pending';

    function LogoutProbe() {
      const { me, loading } = useMe();
      const logout = useLogout();
      if (loading) return <p>loading</p>;
      return (
        <>
          <p>{me ? `signed in as ${me.name}` : 'signed out'}</p>
          <button
            type="button"
            onClick={() => {
              logout().then(
                () => (outcome = 'resolved'),
                () => (outcome = 'rejected'),
              );
            }}
          >
            Log out
          </button>
        </>
      );
    }

    render(
      <Providers client={client}>
        <LogoutProbe />
      </Providers>,
    );
    expect(await screen.findByText('signed in as Ada Admin')).toBeInTheDocument();
    client.setQueryData(['keys'], ['k1']);
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('signed out')).toBeInTheDocument();
    await waitFor(() => expect(outcome).toBe('resolved'));
    expect(client.getQueryData(['keys'])).toBeUndefined();
  });

  it('RequireRole hides admin page from member', async () => {
    mockFetch({ 'GET /api/auth/me': () => jsonResponse(200, { user: member }) });
    const router = createMemoryRouter(
      [
        {
          path: '/team',
          element: (
            <RequireAuth>
              <RequireRole role="admin">team admin page</RequireRole>
            </RequireAuth>
          ),
        },
      ],
      { initialEntries: ['/team'] },
    );
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this page' })).toBeInTheDocument();
    expect(screen.queryByText('team admin page')).not.toBeInTheDocument();
  });

  it('RequireRole shows the page to an admin', async () => {
    mockFetch({ 'GET /api/auth/me': () => jsonResponse(200, { user: admin }) });
    const router = createMemoryRouter(
      [
        {
          path: '/team',
          element: (
            <RequireAuth>
              <RequireRole role="admin">team admin page</RequireRole>
            </RequireAuth>
          ),
        },
      ],
      { initialEntries: ['/team'] },
    );
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );
    expect(await screen.findByText('team admin page')).toBeInTheDocument();
  });
});
