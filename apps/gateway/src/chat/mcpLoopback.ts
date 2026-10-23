import { Client, StreamableHTTPClientTransport, type CallToolResult, type FetchLike } from '@modelcontextprotocol/client';
import type { ToolSpec } from './llm/types.js';
import { GATEWAY_VERSION } from '../version.js';

/** The agent's view of the gateway's own /mcp: the aggregated tools, called as the chat user. */
export interface McpToolClient {
  listTools(): Promise<ToolSpec[]>;
  /** Tool failures (including a rejected credential) come back as `isError`; it throws only when `signal` aborted. */
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<{ isError: boolean; text: string }>;
  close(): Promise<void>;
}

const CLIENT_INFO = { name: 'urumi-gateway-chat', version: GATEWAY_VERSION };
const CONNECT_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 20_000;
/** The turn signal is the real limit; this only keeps the SDK's 60 s default from cutting in first. */
const CALL_TIMEOUT_MS = 120_000;

/** The text the model sees for a tool result: its text parts, else its structured content. */
function resultText(r: CallToolResult): string {
  const parts: string[] = [];
  for (const c of r.content) parts.push(c.type === 'text' ? c.text : `[${c.type} content omitted]`);
  if (!parts.some((p) => p.length > 0) && r.structuredContent !== undefined) return JSON.stringify(r.structuredContent);
  return parts.join('\n');
}

/**
 * A real MCP client to the gateway's own /mcp over HTTP loopback (ADR-010), so chat goes through the same
 * auth, routing, limits and audit as an external client. Every HTTP request carries a freshly minted
 * internal token, so a long turn never outlives its 300 s token. The token is only ever in this header.
 * `signal` is the turn's: an aborted signal rejects at once, and an abort during the connect closes the transport.
 */
export async function connectLoopback(mcpUrl: string, mintToken: () => Promise<string>, signal?: AbortSignal): Promise<McpToolClient> {
  // A turn that is already cancelled never opens a connection or mints a token.
  signal?.throwIfAborted();
  // The status of the last rejected POST (401/403), so a refused call can be told apart from other failures.
  let rejectedStatus: number | null = null;
  const authFetch: FetchLike = async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${await mintToken()}`);
    const res = await fetch(url, { ...init, headers });
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && (res.status === 401 || res.status === 403)) rejectedStatus = res.status;
    return res;
  };
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { fetch: authFetch });
  const client = new Client(CLIENT_INFO, { versionNegotiation: { mode: 'auto' } });
  try {
    const connectSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(CONNECT_TIMEOUT_MS)]) : AbortSignal.timeout(CONNECT_TIMEOUT_MS);
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, signal: connectSignal });
  } catch (err) {
    // Also closes the transport (and any request in flight) when the turn was cancelled during the connect.
    await client.close().catch(() => {});
    throw err;
  }

  let closed = false;
  return {
    async listTools() {
      const { tools } = await client.listTools(undefined, { timeout: LIST_TIMEOUT_MS, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      return tools.map((t) => ({ name: t.name, description: t.description ?? '', parameters: t.inputSchema as Record<string, unknown> }));
    },

    async callTool(name, args, signal) {
      rejectedStatus = null;
      try {
        const result = await client.callTool({ name, arguments: args as Record<string, unknown> }, { signal, timeout: CALL_TIMEOUT_MS });
        return { isError: result.isError === true, text: resultText(result) };
      } catch (err) {
        if (signal.aborted) throw err;
        // SDK and transport messages are not passed on (they can quote URLs and response bodies).
        if (rejectedStatus !== null) return { isError: true, text: `The gateway rejected this tool call (HTTP ${rejectedStatus}): this account cannot use tools right now.` };
        return { isError: true, text: 'The tool call failed before a result was returned.' };
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      // Aborts any request still in flight.
      await client.close().catch(() => {});
    },
  };
}
