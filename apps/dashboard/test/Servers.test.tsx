import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ServerView } from '../src/features/servers/api';
import { Servers } from '../src/pages/Servers';
import { admin, errorResponse, jsonResponse, member, mockFetch, Providers } from './helpers';

function make(over: Partial<ServerView>): ServerView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'notes',
    name: 'Notes',
    url: 'http://notes:3000/mcp',
    authType: 'none',
    authHeaderName: null,
    hasCredential: false,
    enabled: true,
    status: 'connected',
    lastError: null,
    checkedAt: new Date().toISOString(),
    toolCount: 4,
    tools: [],
    skippedTools: [],
    ...over,
  };
}

const list: ServerView[] = [
  make({}),
  make({ id: '22222222-2222-4222-8222-222222222222', slug: 'woo', name: 'Store', status: 'unreachable', lastError: 'connect ECONNREFUSED 10.0.0.1:80', toolCount: 0 }),
  make({ id: '33333333-3333-4333-8333-333333333333', slug: 'utils', name: 'Utils', status: 'disabled', enabled: false }),
];

function renderServersMock(user: typeof admin) {
  const fn = mockFetch({ 'GET /api/auth/me': () => jsonResponse(200, { user }), 'GET /api/servers': () => jsonResponse(200, list) });
  const router = createMemoryRouter([{ path: '/servers', element: <Servers /> }], { initialEntries: ['/servers'] });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return fn;
}

function renderServers(user: typeof admin, servers: () => Response) {
  mockFetch({ 'GET /api/auth/me': () => jsonResponse(200, { user }), 'GET /api/servers': servers });
  const router = createMemoryRouter([{ path: '/servers', element: <Servers /> }, { path: '/servers/:id', element: <p>detail page</p> }], {
    initialEntries: ['/servers'],
  });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}

describe('Servers', () => {
  it('member sees no Add server', async () => {
    const fetchMock = renderServersMock(member);
    await screen.findByText('Notes');
    // Proof the member session resolved before asserting absence.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.anything()));
    await screen.findByRole('heading', { name: 'Servers' });
    expect(screen.queryByRole('button', { name: /add server/i })).not.toBeInTheDocument();
  });

  it('admin sees Add server', async () => {
    renderServers(admin, () => jsonResponse(200, list));
    expect(await screen.findByRole('button', { name: /add server/i })).toBeInTheDocument();
  });

  it('renders status labels not only colours', async () => {
    renderServers(admin, () => jsonResponse(200, list));
    await screen.findByText('Notes');
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toHaveAttribute('title', 'connect ECONNREFUSED 10.0.0.1:80');
  });

  it('row click goes to the detail page', async () => {
    const router = renderServers(admin, () => jsonResponse(200, list));
    await userEvent.click(await screen.findByText('Store'));
    expect(router.state.location.pathname).toBe('/servers/22222222-2222-4222-8222-222222222222');
  });

  it('empty list shows EmptyState', async () => {
    renderServers(admin, () => jsonResponse(200, []));
    expect(await screen.findByText('No servers yet')).toBeInTheDocument();
  });

  it('error shows ErrorState with retry', async () => {
    let calls = 0;
    renderServers(admin, () => {
      calls += 1;
      return calls === 1 ? errorResponse(500, 'INTERNAL', 'Boom') : jsonResponse(200, list);
    });
    // The first load fails (the test client does not retry); Try again reloads it.
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Notes')).toBeInTheDocument();
  });
});
