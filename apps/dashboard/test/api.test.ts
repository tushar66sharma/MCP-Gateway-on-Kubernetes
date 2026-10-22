import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, onUnauthenticated } from '../src/lib/api';
import { errorResponse, mockFetch } from './helpers';

describe('apiFetch', () => {
  const unsubscribers: Array<() => void> = [];
  afterEach(() => unsubscribers.splice(0).forEach((off) => off()));

  it('maps error JSON to ApiError', async () => {
    mockFetch({ 'GET /api/servers/x': () => errorResponse(404, 'NOT_FOUND', 'Server not found', { details: { id: 'x' } }) });
    const err = await apiFetch('/api/servers/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      requestId: 'req-not_found',
      message: 'Server not found',
      details: { id: 'x' },
    });
  });

  it('sends JSON content type on DELETE', async () => {
    const fetchMock = mockFetch({ 'DELETE /api/keys/k1': () => new Response(null, { status: 204 }) });
    await apiFetch('/api/keys/k1', { method: 'DELETE' });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBeUndefined();
  });

  it('serialises the body and omits Content-Type on GET', async () => {
    const fetchMock = mockFetch({
      'POST /api/keys': () => new Response(JSON.stringify({ ok: 1 }), { status: 201 }),
      'GET /api/keys': () => new Response('[]', { status: 200 }),
    });
    await expect(apiFetch('/api/keys', { method: 'POST', body: { name: 'ci' } })).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"name":"ci"}');
    await expect(apiFetch('/api/keys')).resolves.toEqual([]);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('Content-Type')).toBe(false);
  });

  it('204 returns undefined', async () => {
    mockFetch({ 'POST /api/auth/logout': () => new Response(null, { status: 204 }) });
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('network failure is NETWORK', async () => {
    mockFetch({
      'GET /api/servers': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(apiFetch('/api/servers')).rejects.toMatchObject({ name: 'ApiError', code: 'NETWORK', status: 0 });
  });

  it('a non-JSON response is NETWORK', async () => {
    mockFetch({ 'GET /api/servers': () => new Response('<html>502 Bad Gateway</html>', { status: 502 }) });
    await expect(apiFetch('/api/servers')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('an aborted request rejects with the abort, not NETWORK', async () => {
    const controller = new AbortController();
    mockFetch({
      'GET /api/servers': () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    });
    const err = await apiFetch('/api/servers', { signal: controller.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('401 calls onUnauthenticated except for login', async () => {
    const handler = vi.fn();
    unsubscribers.push(onUnauthenticated(handler));
    mockFetch({
      'GET /api/servers': () => errorResponse(401, 'UNAUTHENTICATED'),
      'POST /api/auth/login': () => errorResponse(401, 'UNAUTHENTICATED'),
    });
    await expect(apiFetch('/api/servers')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(apiFetch('/api/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } })).rejects.toMatchObject({
      status: 401,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops calling a handler after it unsubscribes', async () => {
    const handler = vi.fn();
    const off = onUnauthenticated(handler);
    off();
    mockFetch({ 'GET /api/keys': () => errorResponse(401, 'UNAUTHENTICATED') });
    await apiFetch('/api/keys').catch(() => undefined);
    expect(handler).not.toHaveBeenCalled();
  });

  it('reads Retry-After into retryAfterSec', async () => {
    mockFetch({
      'POST /api/auth/login': () => errorResponse(429, 'RATE_LIMITED', 'Too many', { headers: { 'Retry-After': '42' } }),
    });
    await expect(apiFetch('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSec: 42,
    });
  });

  it('falls back to details.retryAfterSec when the header is missing', async () => {
    mockFetch({ 'POST /api/chat': () => errorResponse(429, 'LLM_RATE_LIMITED', 'Busy', { details: { retryAfterSec: 7 } }) });
    await expect(apiFetch('/api/chat', { method: 'POST', body: {} })).rejects.toMatchObject({ retryAfterSec: 7 });
  });
});
