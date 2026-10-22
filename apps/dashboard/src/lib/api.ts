/**
 * The one way the dashboard talks to the gateway's REST API (`/api`).
 *
 * - Same-origin cookies (`ugw_session`), JSON in and out.
 * - Mutating calls always carry `Content-Type: application/json`: the gateway's CSRF guard requires it
 *   (together with `Origin`, which the browser adds), even on a DELETE without a body.
 * - Every failure becomes an `ApiError`, so pages handle one error type.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiFetchInit {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSec?: number;

  constructor(init: {
    code: string;
    status: number;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
    retryAfterSec?: number;
  }) {
    super(init.message);
    this.code = init.code;
    this.status = init.status;
    if (init.requestId !== undefined) this.requestId = init.requestId;
    if (init.details !== undefined) this.details = init.details;
    if (init.retryAfterSec !== undefined) this.retryAfterSec = init.retryAfterSec;
  }
}

/** The message pages show for `code: 'NETWORK'`. */
export const NETWORK_MESSAGE = 'Can’t reach the gateway. Check your connection and try again.';

const LOGIN_PATH = '/api/auth/login';
const unauthenticatedHandlers = new Set<() => void>();

/**
 * Registers a callback for "the session is gone" (any `401 UNAUTHENTICATED` except from login, where a
 * 401 just means wrong credentials). Returns the unsubscribe function.
 */
export function onUnauthenticated(handler: () => void): () => void {
  unauthenticatedHandlers.add(handler);
  return () => {
    unauthenticatedHandlers.delete(handler);
  };
}

function networkError(cause?: unknown): ApiError {
  const err = new ApiError({ code: 'NETWORK', status: 0, message: NETWORK_MESSAGE });
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  return err;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Retry-After` as delta-seconds or an HTTP date; falls back to the body's `details.retryAfterSec`. */
function readRetryAfter(res: Response, details: Record<string, unknown> | undefined): number | undefined {
  const header = res.headers.get('Retry-After');
  if (header !== null && header.trim() !== '') {
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const at = Date.parse(trimmed);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const fromBody = details?.retryAfterSec;
  return typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : undefined;
}

function toApiError(res: Response, payload: unknown): ApiError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const details = error && isRecord(error.details) ? error.details : undefined;
  const requestId = typeof error?.requestId === 'string' ? error.requestId : undefined;
  const retryAfterSec = readRetryAfter(res, details);
  return new ApiError({
    code: typeof error?.code === 'string' ? error.code : `HTTP_${res.status}`,
    status: res.status,
    message: typeof error?.message === 'string' ? error.message : `Request failed with status ${res.status}`,
    ...(requestId !== undefined && { requestId }),
    ...(details !== undefined && { details }),
    ...(retryAfterSec !== undefined && { retryAfterSec }),
  });
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      ...(init.signal !== undefined && { signal: init.signal }),
    });
  } catch (err) {
    // A cancelled request is not a failure; let the caller (or React Query) see the abort itself.
    if (init.signal?.aborted) throw err;
    throw networkError(err);
  }

  if (res.status === 204 || res.status === 205) return undefined as T;

  let payload: unknown;
  try {
    const text = await res.text();
    payload = text === '' ? undefined : JSON.parse(text);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    // HTML from a proxy (502 page) or a truncated body: the gateway was not really reached.
    throw networkError(err);
  }

  if (!res.ok) {
    const error = toApiError(res, payload);
    if (error.status === 401 && error.code === 'UNAUTHENTICATED' && path !== LOGIN_PATH) {
      for (const handler of [...unauthenticatedHandlers]) handler();
    }
    throw error;
  }
  return payload as T;
}

/** A user-facing message for any error a page catches. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.code === 'NETWORK' ? NETWORK_MESSAGE : err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}
