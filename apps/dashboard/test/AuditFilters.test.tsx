import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router';
import { describe, expect, it } from 'vitest';
import { parseFilters, serializeFilters } from '../src/features/audit/api';
import { AuditFilters } from '../src/features/audit/AuditFilters';
import { useMe } from '../src/lib/auth';
import { admin, jsonResponse, member, mockFetch, Providers } from './helpers';

const servers = [
  { id: 's1', slug: 'woo', name: 'Store' },
  { id: 's2', slug: 'notes', name: 'Notes' },
];
const users = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com', name: 'Ada', role: 'admin', disabled: false, createdAt: '2026-01-01T00:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'max@example.com', name: 'Max', role: 'member', disabled: false, createdAt: '2026-01-01T00:00:00Z' },
];

/** Shows the resolved session role, so absence assertions wait for it instead of racing /me. */
function RoleProbe() {
  const { me } = useMe();
  return <p data-testid="role">{me?.role ?? 'loading'}</p>;
}

function Harness() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <AuditFilters value={parseFilters(params)} onChange={(v) => setParams(serializeFilters(v))} />
      <p data-testid="search">{params.toString()}</p>
    </>
  );
}

function renderBar(user: typeof admin, entry = '/audit') {
  mockFetch({
    'GET /api/auth/me': () => jsonResponse(200, { user }),
    'GET /api/servers': () => jsonResponse(200, servers),
    'GET /api/users': () => jsonResponse(200, users),
  });
  const router = createMemoryRouter([{ path: '/audit', element: <Harness /> }], { initialEntries: [entry] });
  render(
    <Providers>
      <RoleProbe />
      <RouterProvider router={router} />
    </Providers>,
  );
}

const search = () => new URLSearchParams(screen.getByTestId('search').textContent ?? '');

describe('AuditFilters', () => {
  it('filters round-trip through URL params', async () => {
    renderBar(admin, '/audit?serverSlug=woo&outcome=error&toolName=create_product&from=2026-10-01T08%3A00');
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));

    await waitFor(() => expect(screen.getByLabelText('Server')).toHaveValue('woo'));
    expect(screen.getByLabelText('Outcome')).toHaveValue('error');
    expect(screen.getByLabelText('Tool name')).toHaveValue('create_product');
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-01T08:00');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Outcome'), 'timeout');
    await waitFor(() => expect(search().get('outcome')).toBe('timeout'));

    await user.clear(screen.getByLabelText('Tool name'));
    await user.type(screen.getByLabelText('Tool name'), 'list_orders{Enter}');
    await waitFor(() => expect(search().get('toolName')).toBe('list_orders'));

    expect(search().get('serverSlug')).toBe('woo');
    expect(search().get('from')).toBe('2026-10-01T08:00');

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => expect(search().toString()).toBe(''));
  });

  it('ignores an unknown outcome in the URL and trims the tool name', () => {
    expect(parseFilters(new URLSearchParams('outcome=bogus')).outcome).toBe('');
    expect(parseFilters(new URLSearchParams('toolName=%20x%20')).toolName).toBe('x');
  });

  it('member has no user filter', async () => {
    renderBar(member);
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('member'));
    await screen.findByLabelText('Server');
    expect(screen.queryByLabelText('User')).toBeNull();
  });

  it('admin has a user filter (control for the member test)', async () => {
    renderBar(admin);
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
    expect(await screen.findByLabelText('User')).toBeInTheDocument();
  });
});
