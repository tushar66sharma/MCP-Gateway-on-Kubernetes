import { ProtocolError, SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { SsrfError } from '../security/ssrf.js';

/** Thrown by the connection's fetch for any 3xx: redirects are never followed. */
export class UpstreamRedirectError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} from upstream (redirects are not followed)`);
    this.name = 'UpstreamRedirectError';
  }
}

const MAX_DEPTH = 8;

/** The error and its `cause` chain, outermost first. */
function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur = err;
  while (cur !== undefined && cur !== null && out.length < MAX_DEPTH && !out.includes(cur)) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

function codeOf(e: unknown): unknown {
  return (e as { code?: unknown } | null)?.code;
}

function isTimeout(e: unknown): boolean {
  // SdkError REQUEST_TIMEOUT: the per-request `timeout` (callTool/listTools: "Request timed out";
  // connect: "Version negotiation probe timed out after <n>ms").
  if (e instanceof SdkError && e.code === SdkErrorCode.RequestTimeout) return true;
  // DOMException TimeoutError / AbortError: our AbortSignal.timeout firing inside fetch.
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Human-readable reason for the dashboard and for `isError` texts. Matching was derived from the real
 * errors the SDK 2.3.1 client raised against the test fakes (see the task 3.5 report); the outer error is
 * often a wrapper (SdkError ERA_NEGOTIATION_FAILED → TypeError 'fetch failed' → the socket error), so the
 * whole `cause` chain is searched. Never includes response bodies, URLs' credentials or headers.
 */
export function describeUpstreamError(err: unknown, timeoutMs: number): string {
  const all = chain(err);
  for (const e of all) {
    // SsrfError from createSafeLookup at connect time (cause of undici's TypeError 'fetch failed'),
    // or from assertSafeUpstreamUrl before connecting.
    if (e instanceof SsrfError) return e.reason === 'dns_failed' ? 'DNS lookup failed' : `blocked by SSRF guard (${e.reason})`;
    // UpstreamRedirectError from our fetch wrapper; the SDK wraps it in SdkError ERA_NEGOTIATION_FAILED at connect.
    if (e instanceof UpstreamRedirectError) return e.message;
  }
  for (const e of all) {
    const code = codeOf(e);
    // Error / AggregateError (one per address for a name with IPv4+IPv6) with code ECONNREFUSED,
    // as the cause of undici's TypeError 'fetch failed'.
    if (code === 'ECONNREFUSED') return 'connection refused';
    // A pooled keep-alive socket the upstream closed: ECONNRESET, or undici's SocketError
    // ('other side closed') with code UND_ERR_SOCKET.
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'connection reset';
    // getaddrinfo Error with code ENOTFOUND (no such name) or EAI_AGAIN (resolver unavailable).
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed';
  }
  for (const e of all) {
    if (isTimeout(e)) return `timeout after ${timeoutMs}ms`;
    // SdkHttpError carries the status: CLIENT_HTTP_AUTHENTICATION for a 401 on the version probe,
    // CLIENT_HTTP_NOT_IMPLEMENTED ("Error POSTing to endpoint: <body>") for other non-2xx. The body is dropped.
    if (e instanceof SdkHttpError) return `HTTP ${e.status} from upstream`;
  }
  // Anything else, e.g. a socket reset (TypeError 'fetch failed' → Error 'other side closed'): the outer
  // message, plus the innermost cause's when it differs, since 'fetch failed' alone explains nothing.
  const message = err instanceof Error ? err.message : String(err);
  const inner = all.at(-1);
  const detail = inner !== err && inner instanceof Error && inner.message && inner.message !== message ? ` (${inner.message})` : '';
  return `error: ${(message + detail).slice(0, 200)}`;
}

/** True when the error (or a cause) is a request timeout or an abort. */
export function isTimeoutError(err: unknown): boolean {
  return chain(err).some(isTimeout);
}

/**
 * HTTP statuses that say the server as a whole is unusable (credential rejected, endpoint gone, server
 * failing). Any other status (e.g. 413 for one oversized request) concerns that call only.
 */
function isServerLevelStatus(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404 || (status !== undefined && status >= 500);
}

/**
 * True for failures of the link to the upstream (refused, DNS, SSRF block, redirect, socket reset,
 * closed transport, HTTP 401/403/404/5xx): during a call the server is then marked unreachable.
 * False for timeouts, for JSON-RPC errors the upstream answered with (ProtocolError) and for other HTTP
 * statuses such as 413: those fail that call only and leave the server connected.
 */
export function isConnectionLevelError(err: unknown): boolean {
  if (err instanceof ProtocolError) return false;
  const all = chain(err);
  if (all.some(isTimeout)) return false;
  // The upstream answered: its status decides, whatever wraps it.
  const http = all.find((e): e is SdkHttpError => e instanceof SdkHttpError);
  if (http) return isServerLevelStatus(http.status);
  return all.some((e) => {
    if (e instanceof SsrfError || e instanceof UpstreamRedirectError) return true;
    if (e instanceof SdkError) return e.code === SdkErrorCode.ConnectionClosed || e.code === SdkErrorCode.NotConnected || e.code === SdkErrorCode.SendFailed;
    const code = codeOf(e);
    if (typeof code === 'string' && /^(E[A-Z]+|UND_ERR_[A-Z_]+)$/.test(code)) return true;
    // undici's fetch rejects every network failure with TypeError('fetch failed').
    return e instanceof TypeError && e.message === 'fetch failed';
  });
}
