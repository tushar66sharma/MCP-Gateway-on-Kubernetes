import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Login, safeNextPath } from '../src/pages/Login';
import { admin, errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

function Landing() {
  const location = useLocation();
  return <p>landed on {location.pathname}</p>;
}

function renderLogin(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '*', element: <Landing /> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

async function submit(email = 'admin@example.com', password = 'correct horse battery') {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

const anonymous = { 'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED') };

describe('Login', () => {
  it('signs in and returns to next', async () => {
    const fetchMock = mockFetch({ ...anonymous, 'POST /api/auth/login': () => jsonResponse(200, { user: admin }) });
    renderLogin('/login?next=%2Fservers%2Fabc');
    await submit();
    expect(await screen.findByText('landed on /servers/abc')).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login');
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ email: 'admin@example.com', password: 'correct horse battery' });
  });

  it('rejects next=//evil.example', async () => {
    mockFetch({ ...anonymous, 'POST /api/auth/login': () => jsonResponse(200, { user: admin }) });
    renderLogin('/login?next=%2F%2Fevil.example');
    await submit();
    expect(await screen.findByText('landed on /')).toBeInTheDocument();
  });

  it('shows rate limit seconds', async () => {
    mockFetch({
      ...anonymous,
      'POST /api/auth/login': () =>
        errorResponse(429, 'RATE_LIMITED', 'Too many login attempts; try again later', { headers: { 'Retry-After': '37' } }),
    });
    renderLogin('/login');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 37 seconds');
  });

  it('shows a clear message for wrong credentials', async () => {
    mockFetch({ ...anonymous, 'POST /api/auth/login': () => errorResponse(401, 'INVALID_CREDENTIALS', 'whatever the server says') });
    renderLogin('/login');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('shows its own message when the gateway cannot be reached', async () => {
    mockFetch({
      ...anonymous,
      'POST /api/auth/login': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderLogin('/login');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach the gateway');
  });

  it('toggles password visibility', async () => {
    mockFetch(anonymous);
    renderLogin('/login');
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/servers', '/servers'],
    ['/audit?outcome=error#top', '/audit?outcome=error#top'],
    [null, '/'],
    ['', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example/x', '/'],
    ['servers', '/'],
    ['/login', '/'],
    ['/%0d%0a', '/%0d%0a'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
