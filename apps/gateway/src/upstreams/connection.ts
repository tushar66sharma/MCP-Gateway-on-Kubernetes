import { Client, StreamableHTTPClientTransport, type CallToolResult, type FetchLike } from '@modelcontextprotocol/client';
import type { Logger, UpstreamAuth } from '@urumi/shared';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { createSafeLookup, type SsrfOptions } from '../security/ssrf.js';
import { UpstreamRedirectError } from './errors.js';

export type UpstreamStatus = 'connected' | 'unreachable' | 'disabled' | 'unknown';

export interface UpstreamRecord {
  id: string;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
  auth: UpstreamAuth;
}

export interface UpstreamToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const CLIENT_INFO = { name: 'urumi-gateway', version: '0.1.0' };

/** RFC 9110 token, and printable ASCII plus space/tab (no CR/LF, so no header injection). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[\x20-\x7e\t]*$/;

/**
 * The upstream's own credential, and nothing else: the gateway client's key is never forwarded.
 * A record whose credential is missing (seeded without its env var) sends no header and gets the
 * upstream's 401, which the health check reports as `HTTP 401 from upstream`.
 */
function authHeaders(auth: UpstreamAuth): Record<string, string> {
  const headers: Record<string, string> =
    auth.kind === 'bearer' && auth.token
      ? { Authorization: `Bearer ${auth.token}` }
      : auth.kind === 'header' && auth.value
        ? { [auth.header]: auth.value }
        : {};
  // Checked here because fetch's own error ("Headers.append: "<value>" is an invalid header value")
  // quotes the value, and that message would reach lastError, the database and the logs.
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(value)) {
      throw new Error('upstream credential contains characters not allowed in an HTTP header');
    }
  }
  return headers;
}

/**
 * One MCP client for one upstream server. Not reused after a failed check: the manager discards it and
 * builds a fresh one (fresh client, fresh transport, fresh socket pool) on the next check.
 */
export class UpstreamConnection {
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private readonly agent: Agent;
  private closed = false;

  constructor(
    readonly record: UpstreamRecord,
    private readonly logger: Logger,
    ssrf: SsrfOptions,
  ) {
    // Every socket this connection opens resolves its host through the SSRF guard again, so a name
    // that passed assertSafeUpstreamUrl cannot re-resolve to a blocked address at connect time
    // (DNS rebinding). IP-literal URLs skip lookup; the literal was already checked.
    this.agent = new Agent({ connect: { lookup: createSafeLookup(ssrf) } });
    const agent = this.agent;
    const safeFetch = async (url: string | URL, init?: UndiciRequestInit) => {
      // `redirect: 'manual'` makes undici hand back the 3xx itself; it is then refused, never followed
      // (a redirect could point at e.g. http://169.254.169.254/).
      const res = await undiciFetch(url, { ...init, dispatcher: agent, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        throw new UpstreamRedirectError(res.status);
      }
      return res;
    };
    this.transport = new StreamableHTTPClientTransport(new URL(record.url), {
      requestInit: { headers: authHeaders(record.auth) },
      // SDK 2.3.1: `StreamableHTTPClientTransportOptions.fetch?: FetchLike` is the custom-fetch option
      // ("Custom fetch implementation used for all network requests"). The single cast below is needed
      // only because undici@7.30.0's RequestInit/Response types are a different copy from the global
      // (@types/node undici-types) ones that FetchLike names. At runtime the SDK passes a plain init
      // (global Headers, string body, AbortSignal), all of which undici's fetch accepts.
      fetch: safeFetch as unknown as FetchLike,
    });
    this.client = new Client(CLIENT_INFO, { versionNegotiation: { mode: 'auto' } });
  }

  async connect(timeoutMs: number): Promise<void> {
    await this.client.connect(this.transport, { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
    this.logger.debug({ server: this.record.slug, era: this.client.getProtocolEra() }, 'upstream connected');
  }

  async listTools(timeoutMs: number): Promise<UpstreamToolInfo[]> {
    // No cursor: the SDK walks every page (capped by listMaxPages). 'refresh' always asks the upstream and
    // re-stores the SDK cache that callTool uses for output-schema validation.
    const { tools } = await this.client.listTools(undefined, { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs), cacheMode: 'refresh' });
    return tools.map((t) => {
      const info: UpstreamToolInfo = { name: t.name, inputSchema: t.inputSchema as Record<string, unknown> };
      if (t.title !== undefined) info.title = t.title;
      if (t.description !== undefined) info.description = t.description;
      if (t.outputSchema !== undefined) info.outputSchema = t.outputSchema as Record<string, unknown>;
      if (t.annotations !== undefined) info.annotations = t.annotations as Record<string, unknown>;
      return info;
    });
  }

  callTool(tool: string, args: Record<string, unknown>, o: { timeoutMs: number; signal?: AbortSignal }): Promise<CallToolResult> {
    return this.client.callTool({ name: tool, arguments: args }, { timeout: o.timeoutMs, signal: o.signal });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // client.close() aborts in-flight requests, so the pool then closes without waiting on them.
    await this.client.close().catch(() => {});
    await this.agent.destroy().catch(() => {});
  }
}
