import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useMe } from '../src/lib/auth';
import { Team } from '../src/pages/Team';
import { admin, errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

const otherAdmin = { id: 'u-admin2', email: 'boss@example.com', name: 'Bo Boss', role: 'admin', disabled: false, createdAt: '2026-01-01T00:00:00.000Z' };
const users = [
  { ...admin, disabled: false, createdAt: '2026-01-01T00:00:00.000Z' },
  otherAdmin,
  { id: 'u-m1', email: 'max@example.com', name: 'Max Member', role: 'member', disabled: false, createdAt: '2026-02-01T00:00:00.000Z' },
  { id: 'u-m2', email: 'off@example.com', name: 'Olive Off', role: 'member', disabled: true, createdAt: '2026-02-02T00:00:00.000Z' },
];
const invites = [
  { id: 'i1', email: 'new@example.com', role: 'member', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), acceptedAt: null, expired: false },
  { id: 'i2', email: 'old@example.com', role: 'admin', expiresAt: new Date(Date.now() - 86_400_000).toISOString(), acceptedAt: null, expired: true },
];
const key = { id: 'k1', name: 'laptop', prefix: 'ugw_abcd', createdAt: '2026-03-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null };

function RoleProbe() {
  const { me } = useMe();
  return <p data-testid="role">{me?.role ?? 'loading'}</p>;
}

function renderTeam(extra: Parameters<typeof mockFetch>[0] = {}) {
  const fetchMock = mockFetch({
    'GET /api/auth/me': () => jsonResponse(200, { user: admin }),
    'GET /api/users': () => jsonResponse(200, users),
    'GET /api/invites': () => jsonResponse(200, invites),
    'GET /api/users/u-m1/keys': () => jsonResponse(200, [key]),
    'GET /api/users/u-admin2/keys': () => jsonResponse(200, []),
    'GET /api/users/u-m2/keys': () => jsonResponse(200, []),
    ...extra,
  });
  render(
    <Providers>
      <RoleProbe />
      <MemoryRouter>
        <Team />
      </MemoryRouter>
    </Providers>,
  );
  return fetchMock;
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
  await screen.findByText('Max Member');
}

describe('Team', () => {
  it('cannot disable self', async () => {
    renderTeam();
    await ready();
    expect(screen.getByRole('button', { name: 'Disable Ada Admin' })).toBeDisabled();
    expect(screen.getByLabelText('Role for Ada Admin')).toBeDisabled();
    // Control: another user can be disabled and have a role change.
    expect(screen.getByRole('button', { name: 'Disable Max Member' })).toBeEnabled();
    expect(screen.getByLabelText('Role for Max Member')).toBeEnabled();
  });

  it('issue key hidden for other admins', async () => {
    renderTeam();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Keys for Bo Boss' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Admins create their own keys/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Issue key' })).toBeNull();
  });

  it('issue key shown for members, and a 409 for a disabled user is inline', async () => {
    renderTeam({ 'POST /api/users/u-m2/keys': () => errorResponse(409, 'CONFLICT', 'User is disabled') });
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Keys for Olive Off' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Key name/), 'ci');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue key' }));
    expect(await within(dialog).findByText('User is disabled')).toBeInTheDocument();
  });

  it('disable shows confirm with revoke warning', async () => {
    const fetchMock = renderTeam({
      'PATCH /api/users/u-m1': () => jsonResponse(200, { user: { ...users[2], disabled: true } }),
    });
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Disable Max Member' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/signs them out and revokes all their API keys/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable user' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(call?.[1]?.body).toBe(JSON.stringify({ disabled: true }));
    });
  });

  it('changing a role sends only the role, after confirming', async () => {
    const fetchMock = renderTeam({ 'PATCH /api/users/u-m1': () => jsonResponse(200, { user: { ...users[2], role: 'admin' } }) });
    await ready();
    await userEvent.selectOptions(screen.getByLabelText('Role for Max Member'), 'admin');
    const dialog = await screen.findByRole('alertdialog', { name: 'Make Max Member an admin?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(call?.[1]?.body).toBe(JSON.stringify({ role: 'admin' }));
    });
  });

  it('a keyboard-style role change opens a confirm and sends nothing yet', async () => {
    const fetchMock = renderTeam();
    await ready();
    const select = screen.getByLabelText<HTMLSelectElement>('Role for Max Member');
    select.focus();
    // ArrowDown on a focused closed select fires `change` in Chrome and Edge on Windows.
    fireEvent.change(select, { target: { value: 'admin' } });
    expect(await screen.findByRole('alertdialog', { name: 'Make Max Member an admin?' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    // The select keeps the current role until the change is confirmed.
    expect(select.value).toBe('member');
  });

  it('cancelling a role change keeps the role and returns focus to the select', async () => {
    const fetchMock = renderTeam();
    await ready();
    const select = screen.getByLabelText<HTMLSelectElement>('Role for Bo Boss');
    await userEvent.selectOptions(select, 'member');
    const dialog = await screen.findByRole('alertdialog', { name: 'Make Bo Boss a member?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(select.value).toBe('admin');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(select));
  });

  it('the role select is disabled while the change is saved', async () => {
    let release: (r: Response) => void = () => undefined;
    renderTeam({ 'PATCH /api/users/u-m1': () => new Promise<Response>((resolve) => (release = resolve)) });
    await ready();
    const select = screen.getByLabelText<HTMLSelectElement>('Role for Max Member');
    await userEvent.selectOptions(select, 'admin');
    const dialog = await screen.findByRole('alertdialog', { name: 'Make Max Member an admin?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    await waitFor(() => expect(select).toBeDisabled());
    release(jsonResponse(200, { user: { ...users[2], role: 'admin' } }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(select).toBeEnabled();
  });

  it('lists pending invites with an Expired badge and cancels with a confirm', async () => {
    const fetchMock = renderTeam({ 'DELETE /api/invites/i1': () => new Response(null, { status: 204 }) });
    await ready();
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel invite for new@example.com' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invite' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });

  it('inviting shows the link once', async () => {
    const link = `https://gw.example.com/invite/${'x'.repeat(43)}`;
    renderTeam({
      'POST /api/invites': () => jsonResponse(201, { invite: { ...invites[0], email: 'q@example.com' }, link }),
    });
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    await userEvent.type(await screen.findByLabelText(/Email/), 'q@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByLabelText('Invite link')).toHaveValue(link);
    expect(screen.getByText(/valid for 72 hours, works once/i)).toBeInTheDocument();
  });

  it('focus stays in the row after Disable and after Enable', async () => {
    let disabled = false;
    renderTeam({
      'GET /api/users': () => jsonResponse(200, users.map((u) => (u.id === 'u-m1' ? { ...u, disabled } : u))),
      'PATCH /api/users/u-m1': (init) => {
        disabled = JSON.parse(String(init?.body)).disabled as boolean;
        return jsonResponse(200, { user: { ...users[2], disabled } });
      },
    });
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Disable Max Member' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disable user' }));
    const enable = await screen.findByRole('button', { name: 'Enable Max Member' });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(enable.parentElement?.contains(document.activeElement)).toBe(true);
    await userEvent.click(enable);
    await screen.findByRole('button', { name: 'Disable Max Member' });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(screen.getByRole('button', { name: 'Disable Max Member' }).parentElement).toBe(document.activeElement);
  });

  it('issuing a key returns focus to the name input when the key dialog closes', async () => {
    renderTeam({ 'POST /api/users/u-m1/keys': () => jsonResponse(201, { key, plaintext: `ugw_${'x'.repeat(43)}` }) });
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Keys for Max Member' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Key name/), 'ci');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue key' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'I have copied the key' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByLabelText(/Key name/)));
  });
});
