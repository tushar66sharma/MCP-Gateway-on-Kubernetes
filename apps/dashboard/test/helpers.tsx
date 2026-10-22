import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { AuthProvider, type Me } from '../src/lib/auth';

export const admin: Me = { id: 'u-admin', email: 'admin@example.com', name: 'Ada Admin', role: 'admin' };
export const member: Me = { id: 'u-member', email: 'member@example.com', name: 'Max Member', role: 'member' };

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function errorResponse(
  status: number,
  code: string,
  message = code,
  extra: { headers?: Record<string, string>; details?: Record<string, unknown> } = {},
): Response {
  const error: Record<string, unknown> = { code, message, requestId: `req-${code.toLowerCase()}` };
  if (extra.details) error.details = extra.details;
  return jsonResponse(status, { error }, extra.headers);
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** Stubs global fetch with per-route handlers keyed by "METHOD /path". Unknown routes fail loudly. */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function Providers({ client, children }: { client?: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client ?? newQueryClient()}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
