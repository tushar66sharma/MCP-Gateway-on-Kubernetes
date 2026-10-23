import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ServerView } from '../src/features/servers/api';
import { ServerFormDialog } from '../src/features/servers/ServerFormDialog';
import { errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

const server: ServerView = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'notes',
  name: 'Notes',
  url: 'https://notes.example.com/mcp',
  authType: 'bearer',
  authHeaderName: null,
  hasCredential: true,
  enabled: true,
  status: 'connected',
  lastError: null,
  checkedAt: null,
  toolCount: 0,
  tools: [],
  skippedTools: [],
};

function renderDialog(props: { server?: ServerView } = {}) {
  render(
    <Providers>
      <ServerFormDialog open onOpenChange={vi.fn()} {...props} />
    </Providers>,
  );
}

const bodyOf = (init: RequestInit | undefined): Record<string, unknown> => JSON.parse(String(init?.body)) as Record<string, unknown>;

describe('ServerFormDialog', () => {
  it('SSRF_REJECTED shows under URL field', async () => {
    mockFetch({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED'),
      'POST /api/servers': () => errorResponse(400, 'SSRF_REJECTED', 'Upstream URL rejected: link-local address'),
    });
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^Slug/), 'meta');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Metadata');
    await userEvent.type(screen.getByLabelText(/^URL/), 'http://169.254.169.254/mcp');
    await userEvent.click(screen.getByRole('button', { name: 'Add server' }));
    const url = screen.getByLabelText(/^URL/);
    await waitFor(() => expect(url).toHaveAccessibleDescription(/link-local address/));
    expect(url).toBeInvalid();
  });

  it('the SSRF error shows the internalUpstreams hint', async () => {
    mockFetch({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED'),
      'POST /api/servers': () => errorResponse(400, 'SSRF_REJECTED', 'Upstream URL rejected: private address'),
    });
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^Slug/), 'extra');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Extra');
    await userEvent.type(screen.getByLabelText(/^URL/), 'http://mcp-extra.tools.svc.cluster.local:3010/mcp');
    await userEvent.click(screen.getByRole('button', { name: 'Add server' }));
    const url = screen.getByLabelText(/^URL/);
    await waitFor(() =>
      expect(url).toHaveAccessibleDescription(/In-cluster servers must be listed in the chart setting gateway\.internalUpstreams\./),
    );
  });

  it('blank credential on edit is omitted from PATCH body', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED'),
      [`PATCH /api/servers/${server.id}`]: () => jsonResponse(200, server),
    });
    renderDialog({ server });
    const name = screen.getByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Notes v2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    const body = bodyOf(call?.[1]);
    expect(body).toMatchObject({ name: 'Notes v2' });
    expect(body).not.toHaveProperty('credential');
    expect(body).not.toHaveProperty('clearCredential');
    expect(body).not.toHaveProperty('slug');
  });

  it('remove credential sends clearCredential true', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED'),
      [`PATCH /api/servers/${server.id}`]: () => jsonResponse(200, { ...server, hasCredential: false }),
    });
    renderDialog({ server });
    await userEvent.click(screen.getByLabelText('Remove stored credential'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    const body = bodyOf(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]);
    expect(body).toMatchObject({ clearCredential: true });
    expect(body).not.toHaveProperty('credential');
  });

  it('blocks submit with an inline error when the origin changes and no credential is given', async () => {
    const fetchMock = mockFetch({ 'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED') });
    renderDialog({ server });
    const url = screen.getByLabelText(/^URL/);
    await userEvent.clear(url);
    await userEvent.type(url, 'https://elsewhere.example.com/mcp');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/different host/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('maps VALIDATION_FAILED issues onto fields', async () => {
    mockFetch({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED'),
      [`PATCH /api/servers/${server.id}`]: () =>
        errorResponse(400, 'VALIDATION_FAILED', 'Validation failed', { details: { issues: [{ path: 'name', message: 'is too long' }] } }),
    });
    renderDialog({ server });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription(/is too long/));
  });

  it('create mode has no Enabled checkbox', () => {
    mockFetch({ 'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED') });
    renderDialog();
    expect(screen.queryByLabelText('Enabled')).not.toBeInTheDocument();
  });

  it('edit mode sends enabled when changed', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED'),
      [`PATCH /api/servers/${server.id}`]: () => jsonResponse(200, server),
    });
    renderDialog({ server });
    await userEvent.click(screen.getByLabelText('Enabled'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    expect(bodyOf(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1])).toMatchObject({ enabled: false });
  });

  it('clears a typed credential when the dialog closes', async () => {
    mockFetch({ 'GET /api/auth/me': () => errorResponse(401, 'UNAUTHENTICATED') });
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <ServerFormDialog open={open} onOpenChange={setOpen} server={server} />
        </>
      );
    }
    render(
      <Providers>
        <Harness />
      </Providers>,
    );
    await userEvent.type(screen.getByLabelText(/^Credential/), 'typed-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(await screen.findByLabelText(/^Credential/)).toHaveValue('');
  });
});
