import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ServerView } from '../src/features/servers/api';
import { ServerDetail } from '../src/pages/ServerDetail';
import { admin, jsonResponse, mockFetch, Providers } from './helpers';

const id = '11111111-1111-4111-8111-111111111111';
const server: ServerView = {
  id,
  slug: 'notes',
  name: 'Notes',
  url: 'http://notes:3000/mcp',
  authType: 'none',
  authHeaderName: null,
  hasCredential: false,
  enabled: true,
  status: 'connected',
  lastError: null,
  checkedAt: null,
  toolCount: 0,
  tools: [],
  skippedTools: [],
};

describe('ServerDetail', () => {
  it('after confirming Disable, focus lands on the page heading, not body', async () => {
    let current = server;
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(200, { user: admin }),
      [`GET /api/servers/${id}`]: () => jsonResponse(200, current),
      [`PATCH /api/servers/${id}`]: () => {
        current = { ...server, enabled: false, status: 'disabled' };
        return jsonResponse(200, current);
      },
    });
    const router = createMemoryRouter([{ path: '/servers/:id', element: <ServerDetail /> }], { initialEntries: [`/servers/${id}`] });
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Disable server' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toHaveFocus());
  });
});
