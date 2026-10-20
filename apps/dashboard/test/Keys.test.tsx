import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Keys } from '../src/pages/Keys';
import { errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

const KEY = `ugw_${'x'.repeat(43)}`;
const key = { id: 'k1', name: 'laptop', prefix: 'ugw_abcd', createdAt: '2026-03-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null };
const revoked = { ...key, id: 'k2', name: 'old', revokedAt: '2026-03-02T00:00:00.000Z' };

describe('Keys', () => {
  it('lists keys with status labels and revokes after a confirm', async () => {
    const fetchMock = mockFetch({
      'GET /api/keys': () => jsonResponse(200, [key, revoked]),
      'DELETE /api/keys/k1': () => new Response(null, { status: 204 }),
    });
    render(<Providers><Keys /></Providers>);
    await screen.findByText('laptop');
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Revoke / })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke laptop' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(true));
  });

  it('creating a key shows the plaintext once and keeps it out of storage', async () => {
    mockFetch({
      'GET /api/keys': () => jsonResponse(200, []),
      'POST /api/keys': () => jsonResponse(201, { key, plaintext: KEY }),
    });
    render(<Providers><Keys /></Providers>);
    await screen.findByText('No API keys yet');
    await userEvent.click(screen.getAllByRole('button', { name: 'Create key' })[0]!);
    await userEvent.type(await screen.findByLabelText(/Key name/), 'laptop');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create key' }));
    expect(await screen.findByLabelText('API key')).toHaveValue(KEY);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(KEY);
  });

  it('shows an empty state and an error with retry', async () => {
    let calls = 0;
    mockFetch({
      'GET /api/keys': () => {
        calls += 1;
        return calls === 1 ? errorResponse(500, 'INTERNAL', 'Boom') : jsonResponse(200, []);
      },
    });
    render(<Providers><Keys /></Providers>);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No API keys yet')).toBeInTheDocument();
  });
});
