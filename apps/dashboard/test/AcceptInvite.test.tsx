import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AcceptInvite } from '../src/pages/AcceptInvite';
import { admin, errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

const TOKEN = 'x'.repeat(43);
const preview = { email: 'new@example.com', role: 'member', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
const newUser = { id: 'u-new', email: 'new@example.com', name: 'Nia New', role: 'member' };

function renderAccept(routes: Parameters<typeof mockFetch>[0]) {
  const fetchMock = mockFetch(routes);
  const router = createMemoryRouter([{ path: '/invite/:token', element: <AcceptInvite /> }, { path: '/', element: <p>home page</p> }], {
    initialEntries: [`/invite/${TOKEN}`],
  });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { fetchMock, router };
}

const signedOut = () => errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');

async function fill(password: string, confirm: string) {
  await userEvent.type(await screen.findByLabelText(/^Name/), 'Nia New');
  await userEvent.type(screen.getByLabelText(/^Password/), password);
  await userEvent.type(screen.getByLabelText(/^Confirm password/), confirm);
}

describe('AcceptInvite', () => {
  it('invalid token shows expired state', async () => {
    renderAccept({
      'GET /api/auth/me': signedOut,
      [`GET /api/invites/${TOKEN}`]: () => errorResponse(404, 'INVITE_INVALID', 'invalid'),
    });
    expect(await screen.findByText(/This invite link is invalid or has expired\. Ask your admin for a new one\./)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
  });

  it('shows the preview with a read-only email', async () => {
    renderAccept({ 'GET /api/auth/me': signedOut, [`GET /api/invites/${TOKEN}`]: () => jsonResponse(200, preview) });
    expect(await screen.findByText(/You’ve been invited as member/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com');
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
  });

  it('password mismatch blocks submit', async () => {
    const { fetchMock } = renderAccept({ 'GET /api/auth/me': signedOut, [`GET /api/invites/${TOKEN}`]: () => jsonResponse(200, preview) });
    await fill('correct horse battery', 'correct horse batterX');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords don’t match')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('short password is rejected inline', async () => {
    renderAccept({ 'GET /api/auth/me': signedOut, [`GET /api/invites/${TOKEN}`]: () => jsonResponse(200, preview) });
    await fill('short', 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
  });

  it('success navigates home', async () => {
    const { fetchMock, router } = renderAccept({
      'GET /api/auth/me': signedOut,
      [`GET /api/invites/${TOKEN}`]: () => jsonResponse(200, preview),
      [`POST /api/invites/${TOKEN}/accept`]: () => jsonResponse(201, { user: newUser }),
    });
    await fill('correct horse battery', 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[1]?.body).toBe(JSON.stringify({ name: 'Nia New', password: 'correct horse battery' }));
  });

  it('notes an existing session', async () => {
    renderAccept({ 'GET /api/auth/me': () => jsonResponse(200, { user: admin }), [`GET /api/invites/${TOKEN}`]: () => jsonResponse(200, preview) });
    expect(await screen.findByText(/You are signed in as Ada Admin; accepting creates a new account/)).toBeInTheDocument();
  });

  it('asks browsers not to send a referrer while mounted', async () => {
    const { router } = renderAccept({ 'GET /api/auth/me': signedOut, [`GET /api/invites/${TOKEN}`]: () => jsonResponse(200, preview) });
    await screen.findByText(/You’ve been invited/);
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    await router.navigate('/');
    await waitFor(() => expect(document.head.querySelector('meta[name="referrer"]')).toBeNull());
  });
});
