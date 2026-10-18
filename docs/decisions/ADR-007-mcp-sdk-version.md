# ADR-007: MCP SDK v2 with `createMcpHandler` (modern + stateless legacy fallback)

## Status

Accepted (2026-10-18, Phase 2 spike).

## Date

2026-10-18

## Context

The MCP TypeScript SDK has two lines, verified against the npm registry on 2026-10-18:

- **v2**: `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.3.1, implementing the **2026-07-28** spec. Streamable HTTP is stateless, a `server/discover` RPC replaces the `initialize` handshake, and there is no GET standalone stream.
- **v1**: `@modelcontextprotocol/sdk` 1.32.1, still maintained. It negotiates the 2025-era versions (latest `2025-11-25`), with optional stateful sessions.

Our gateway is both an MCP client (to upstreams) and an MCP server (to clients), and all our own MCP servers use the same SDK. The risk was that clients we must support (Claude Code, MCP Inspector, Cursor) may not yet speak 2026-07-28.

The Phase 2 spike (Task 2.1) tested this. It built servers and clients in a scratch folder outside the repo, typechecked them with TypeScript 6.0.3 (`strict`, `noUncheckedIndexedAccess`, NodeNext), and ran them on Node 24.0.1 (Windows 11).

**Limitations of the evidence:**

- **Clients covered:** the v1 SDK client (`@modelcontextprotocol/sdk` 1.32.1, which speaks `2025-11-25`), the v2 client (`legacy`, `auto` and `pin`/modern modes) and MCP Inspector 2.11.0 CLI (`legacy`, `auto` and `modern` eras).
- **Claude Code and Cursor are not yet tested.** The `claude` CLI is not on PATH on the spike machine. Claude Code is verified against the gateway in Phase 3.
- **Two kinds of client behaviour were not covered:**
  - clients that require an `Mcp-Session-Id` (the server never issues one);
  - clients that require the GET SSE stream (the server answers `405`).

  The v1 SDK client and Inspector tolerate both, but other clients might not.

## Decision

- **Use v2 for every component**, with these exact versions:

  | Package | Version | Kind | Role |
  |---|---|---|---|
  | `@modelcontextprotocol/server` | 2.3.1 | dependency | `McpServer`, `createMcpHandler`, `fromJsonSchema` |
  | `@modelcontextprotocol/client` | 2.3.1 | dependency | gateway → upstream client |
  | `@modelcontextprotocol/express` | 2.0.2 | dependency | `hostHeaderValidation` middleware |
  | `@modelcontextprotocol/node` | 2.1.1 | dependency | `toNodeHandler` (Node `req`/`res` ↔ web `Request`/`Response`); pulls in `hono` 4.13.13 and `@hono/node-server` 1.19.17 |
  | `zod` | 4.6.7 | dependency | tool input/output schemas |
  | `express` | 5.3.0 | dependency | HTTP app |
  | `@types/express` | 5.0.6 (latest 5.x on 2026-10-18) | devDependency | types for snippet 2 |

- **Serve HTTP with `createMcpHandler(factory)`, mounted through `toNodeHandler`.** The default `legacy: 'stateless'` posture serves 2026-07-28 clients on the modern path. It also answers 2025-era clients (`initialize` handshake) with a fresh stateless instance per request, from the same tool definition. GET and DELETE on `/mcp` get `405`.

  On one endpoint this was verified with the v1 SDK client, the v2 client (auto/legacy/modern) and MCP Inspector 2.11.0. Claude Code and Cursor are not yet tested.
- **Do not** use `NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (the example in the express/node READMEs). It serves the 2025 era only (see matrix).
- **Do not** use `legacy: 'reject'`. It locks out every 2025-era client.
- **Clients set `versionNegotiation: { mode: 'auto' }`.** The v2 `Client` defaults to `'legacy'`, the plain 2025 handshake. `'auto'` probes `server/discover` and falls back to `initialize`, so the gateway can reach both v2 and v1 upstreams. Pinning `{ pin: '2026-07-28' }` fails against any 2025-era server.
- **Host-header validation applies to `/mcp` only, never to probes.** The allowed hostnames come from configuration. See "Host validation (DNS rebinding)" below.
- **The gateway uses `McpServer` with raw handlers on `mcp.server`**, not the deprecated low-level `Server` class and not `registerTool`. See "Gateway server route" below.
- Every MCP server still exposes **`POST /mcp`** for JSON-RPC, plus `GET /healthz` (liveness) and `GET /readyz` (readiness).

**Why v2:** all three required clients worked against a v2 server: (a) the Inspector CLI, (b) the v2 client and (c) the v1 SDK client. Each one listed tools and called a tool with `structuredContent`. The v1 client works because of the built-in stateless legacy fallback (decision gap 1: "if v2 can serve both v1 and v2 clients, choose v2"). v1 was therefore not needed, and the v1-only re-run of Steps 2–3 was skipped.

### Host validation (DNS rebinding)

What was observed:

- `hostHeaderValidation(list)` compares the hostname only, ignoring the port.
- If the Host header is not in the list, the request gets `403 {"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: <name>"},"id":null}`.
- `createMcpExpressApp({ allowedHosts })` installs this check **app-wide**, including `/healthz`. With it, `GET /healthz` sent with `Host: 10.42.0.15:3001` returned `403`. Kubelet HTTP probes send `Host: <pod IP>:<port>`, so a pod built that way would never become ready. Snippet 2 therefore builds a plain `express()` app and puts the validation on `/mcp` only.

Recommendation for `startMcpHttpServer` (Task 2.2): take an `allowedHosts` option, read from env `MCP_ALLOWED_HOSTS` (comma-separated).

- **Default:** `localhost,127.0.0.1`. This fails closed.
- **In the cluster:** the Helm chart sets the Service names, `<svc>,<svc>.<ns>,<svc>.<ns>.svc,<svc>.<ns>.svc.cluster.local,localhost,127.0.0.1`, for example `mcp-woocommerce,mcp-woocommerce.mcp,…`.

For the gateway, the list also includes its public Ingress host.

Security reasoning:

- **The bearer token is the primary control.** Every one of our MCP servers requires `Authorization: Bearer <token>` (spec §5.2, §5.3).
- **DNS rebinding is a weak threat here.**
  - It needs a victim's browser to reach the server's address under an attacker's hostname.
  - A ClusterIP Service is not browser-reachable.
  - A rebinding page would not know the token.
- **The Host check is kept anyway, as cheap defence in depth:**
  - a `kubectl port-forward` to localhost makes a server browser-reachable;
  - NetworkPolicies only arrive in Phase 5;
  - a leaked token plus a reachable address is still blocked unless the Host matches;
  - a wrong list fails closed with a visible `403`.
- **Scope:** the check covers `/mcp` only, so probes are never affected.
- **Rejected option:** disabling validation for bearer-protected, cluster-only servers. It would be acceptable, but it drops a guard for almost no saving. It remains the fallback if the set of hostnames ever becomes impractical to enumerate.

### Gateway server route

The gateway's needs are (a) a dynamic catalog per request and (b) passing an upstream `CallToolResult` through unchanged. Four routes were compared against the same low-level upstream (`gw-compare.ts`). The upstream returns its own distinctive error for bad arguments. Each route was run with a v2 client in `legacy` and `auto` modes, and each result was deep-compared with a direct upstream call (ignoring `_meta`):

| Route | (a) catalog read per request (4 → 5 tools after a runtime add) | (b) `add {a:"two"}` (bad args) | `fail` / `pingerr` (`isError` results) | unknown tool | `@typescript-eslint/no-deprecated` |
|---|---|---|---|---|---|
| deprecated low-level `Server` + `setRequestHandler` | yes | identical to upstream | identical | gateway's own `isError` result | **error** ("`Server` is deprecated") |
| `McpServer.registerTool` + `fromJsonSchema` (default validator) | yes | **rewritten**: `Input validation error: Invalid arguments for tool woo__add: data must have required property 'b', data/a must be number` | identical | `ProtocolError -32602 Tool woo__nope not found` | clean |
| `McpServer.registerTool` + `fromJsonSchema(schema, passThroughValidator)` | yes | identical to upstream | identical | `ProtocolError -32602` | clean |
| **`McpServer` + `mcp.server.setRequestHandler('tools/list'/'tools/call')`** (chosen) | yes | identical to upstream | identical | gateway's own `isError` result | clean |

The chosen route gives the same full control and byte-identical passthrough as the low-level `Server`, without referencing the deprecated class.

- **Risk:** a 2.x release could stop exposing `McpServer.server` or change `setRequestHandler`.
- **Fallback:** `registerTool` + `fromJsonSchema(schema, passThroughValidator)` (snippet 4b). It is verified identical for results, but unknown tools become `-32602`.

## Compatibility matrix

"Pass" means connect, `tools/list`, and `tools/call` returning the expected `content` and `structuredContent`. Each run sent `Authorization: Bearer x`, and the server log confirmed it was received (scheme logged, value redacted). Claude Code and Cursor are not in the matrix (not tested).

| Client ↓ / Server → | v2 `createMcpHandler` (default, legacy stateless) | v2 `createMcpHandler` `legacy:'reject'` | v2 `NodeStreamableHTTPServerTransport` stateless | v2 low-level `Server` (dynamic tools) via `createMcpHandler` | v1 1.32.1 `StreamableHTTPServerTransport` stateless |
|---|---|---|---|---|---|
| Inspector 2.11.0 CLI, default (= `--protocol-era legacy`) | **Pass** (2025-11-25) | Fail: HTTP 400 `-32022 Unsupported protocol version: 2025-11-25`, `data.supported: ["2026-07-28"]` | Pass (tools/call only) | tools/list Pass; tools/call not run | Pass (tools/call only) |
| Inspector `--protocol-era auto` | **Pass** (2026-07-28) | not run | not run | not run | Pass (tools/call only; fell back to 2025) |
| Inspector `--protocol-era modern` | **Pass** (2026-07-28) | not run | Fail: `Version negotiation failed: the server did not offer pinned protocol version 2026-07-28 via server/discover (no fallback in pin mode)` | tools/call Pass; tools/list not run | Fail (same message) |
| v2 client, `mode: 'legacy'` (SDK default) | **Pass** (2025-11-25) | Fail: `SdkError CLIENT_HTTP_NOT_IMPLEMENTED … -32022 Unsupported protocol version: 2025-11-25` | Pass | Pass | Pass |
| v2 client, `mode: 'auto'` | **Pass** (2026-07-28) | Pass (2026-07-28) | Pass (fell back to 2025-11-25) | Pass (2026-07-28) | Pass (fell back to 2025-11-25) |
| v2 client, `pin: '2026-07-28'` | **Pass** | not run | Fail: `SdkError ERA_NEGOTIATION_FAILED` (message as above) | Pass | Fail: `ERA_NEGOTIATION_FAILED` |
| v1 client 1.32.1 (stand-in for older clients) | **Pass** (2025-11-25, no session id) | Fail: `Streamable HTTP error: Error POSTing to endpoint: {"code":-32022,"message":"Unsupported protocol version: 2025-11-25",…}` | Pass | Pass | Pass |

Other verified behaviour:

- Legacy clients (the v1 SDK client and Inspector legacy) issue `GET /mcp` for a standalone stream after `initialize`. They receive `405 {"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}` and continue normally. Clients that *require* that stream were not tested.

## Alternatives considered

- **v1 (`@modelcontextprotocol/sdk` 1.32.1) stateless for everything.** It works with v1 clients, the Inspector legacy era and the v2 client in `legacy`/`auto`. It cannot serve 2026-07-28 clients (Inspector `modern` and v2 `pin` both fail), and it is the older line. Rejected because v2 serves both eras for every client tested.
- **v2 with `NodeStreamableHTTPServerTransport` per request** (the README example). It serves the 2025 era only. Rejected.
- **v2 `legacy: 'reject'` (modern only).** It breaks every 2025-era client, including today's Inspector default and the v1 client. Rejected.
- **`createMcpExpressApp({ allowedHosts })`.** Its Host check also covers `/healthz` and `/readyz`, which kubelet probes would fail. Rejected in favour of route-level `hostHeaderValidation`.
- **Deprecated low-level `Server`, or `registerTool` + `fromJsonSchema`, for the gateway.** See "Gateway server route"; both were kept only as a fallback.
- **v1 with stateful sessions.** Rejected as before: sessions need affinity or shared state across gateway replicas.
- **Mixing versions per component.** Rejected: more moving parts, and `packages/shared` should use one SDK.

## Consequences/trade-offs

- **Stateless everywhere.** `createMcpHandler` calls the factory once per HTTP request, so no MCP session state exists. This suits a multi-replica gateway, and its per-request `tools/list` reads the current catalog (ADR-014).
- **One extra package.** `@modelcontextprotocol/node` 2.1.1 is needed for `toNodeHandler`, because `@modelcontextprotocol/express` does not include an MCP transport. It brings `hono` and `@hono/node-server` as transitive dependencies.
- **Error shapes clients see** (verified):
  - A tool returning `isError: true` reaches the client as a normal result with `isError: true`.
  - Invalid arguments to a zod-registered `McpServer` tool also come back as an `isError: true` result (`"Input validation error: Invalid arguments for tool add: a: Invalid input: expected number, received string, …"`), not as a JSON-RPC error.
  - An unknown tool on `registerTool`-based servers throws `ProtocolError` code `-32602` (`Tool nope not found`).
  - A client `timeout` or an aborted `signal` both reject with `SdkError` code `REQUEST_TIMEOUT`. An abort's message is `AbortError: This operation was aborted`; `AbortSignal.timeout()` gives `TimeoutError: …`. The connection stays usable afterwards.
- **`Tool['inputSchema']` needs a cast** to `JsonSchemaType` for `fromJsonSchema` (TS2345 without it).
- **Proxied results carry upstream `_meta`.** On the 2026-07-28 era, a pass-through result includes `_meta["io.modelcontextprotocol/serverInfo"]` naming the upstream. Phase 3 should decide whether to strip or overwrite it.
- **JSON body limit.** Snippet 2 sets `express.json({ limit: '1mb' })`; Express's default is `100kb`.
- **TypeScript 6 needs `"types": ["node"]`** in `tsconfig.json` (stated in the server/client READMEs; the spike used it).
- Running `.ts` directly on Node 24.0.1 (type stripping) prints an `ExperimentalWarning`. The real build compiles with `tsc`, so this only affected the spike.

## API cheat sheet

**Status:** every snippet below is a complete file.

**How each one was proven:** it was copied out of this ADR by a script into `adr/snippet-N.ts` in the scratch spike, typechecked, run, and probed. The typecheck was `tsc` 6.0.3 with `strict`, `noUncheckedIndexedAccess`, `NodeNext`, `types: ["node"]`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. Each one ran on Node 24.0.1 with `node --no-warnings adr/snippet-N.ts`, against the packages in the table above. The "Proof" line under each snippet names the command and the observed output.

**Change after the spike (Phase 2 final review, 2026-10-19).** The `MCP_ALLOWED_HOSTS` line of snippets 4 and 4b now drops empty entries, lowercases them and throws on an empty list, like `apps/mcp-woocommerce/src/config.ts` and `normalizeHosts` in `packages/shared`. All five snippets were re-extracted with the same script and typechecked again. Snippet 4b was re-run: with `MCP_ALLOWED_HOSTS="LocalHost,,127.0.0.1,"` an `initialize` to `localhost` got 200 and `Host: evil.example` got 403; with `" , ,"` it stopped with `MCP_ALLOWED_HOSTS lists no host`. Snippet 4 was typechecked but not re-run (it needs an upstream server).

### 1. Imports

```ts
// Every import the snippets below use. Each snippet repeats the ones it needs.
import express from 'express';
import { z } from 'zod';
import {
  McpServer, createMcpHandler, fromJsonSchema,
  type JsonSchemaType, type JsonSchemaValidator, type Tool, type jsonSchemaValidator,
} from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Client, StreamableHTTPClientTransport, ProtocolError, SdkError, SdkErrorCode } from '@modelcontextprotocol/client';

console.log([express, z, McpServer, createMcpHandler, fromJsonSchema, hostHeaderValidation, toNodeHandler, Client, StreamableHTTPClientTransport, ProtocolError, SdkError, SdkErrorCode].every(Boolean));
```

Proof: `node --no-warnings adr/snippet-1.ts` printed `true`.

### 2 + 3. Server: zod 4 tools, `structuredContent`, `isError`, stateless Streamable HTTP on Express 5

```ts
import express from 'express';
import { z } from 'zod';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';

// One fresh McpServer per HTTP request (createMcpHandler calls this factory).
function buildServer(): McpServer {
  const server = new McpServer({ name: 'mcp-woocommerce', version: '0.1.0' });

  server.registerTool(
    'ping',
    {
      description: 'Replies with pong and the message.',
      inputSchema: z.object({ message: z.string().optional() }),
      outputSchema: z.object({ reply: z.string() }),
    },
    async ({ message }) => {
      const reply = message === undefined ? 'pong' : `pong ${message}`;
      return { content: [{ type: 'text', text: reply }], structuredContent: { reply } };
    },
  );

  server.registerTool(
    'add',
    {
      description: 'Adds two numbers.',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
    },
    async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }], structuredContent: { sum: a + b } }),
  );

  // Tool-level failure: return isError, do not throw. The model sees the text.
  server.registerTool(
    'fail',
    { description: 'Always fails.', inputSchema: z.object({}) },
    async () => ({ content: [{ type: 'text', text: 'WooCommerce returned 503' }], isError: true }),
  );

  return server;
}

interface StartOptions {
  buildServer: () => McpServer;
  port: number;
  // Hostnames (port is ignored) accepted in the Host header of /mcp requests; others get 403.
  // DNS-rebinding protection: a browser page on an attacker's domain that resolves to this
  // server's address still sends `Host: <attacker domain>`, so it is rejected.
  // In-cluster, list every name clients use for the Service:
  //   '<svc>', '<svc>.<ns>', '<svc>.<ns>.svc', '<svc>.<ns>.svc.cluster.local'
  // plus 'localhost' and '127.0.0.1' for port-forward and local runs.
  allowedHosts: string[];
}

function startMcpHttpServer({ buildServer, port, allowedHosts }: StartOptions): { close: () => Promise<void> } {
  // Modern (2026-07-28) + legacy (2025-era, stateless) on the same endpoint.
  const mcpHandler = createMcpHandler(buildServer, {
    onerror: (err) => console.error(`mcp error: ${err.message}`),
  });
  const nodeHandler = toNodeHandler(mcpHandler);

  const app = express();
  // Probes are NOT host-validated: the kubelet sends `Host: <pod IP>:<port>`.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readyz', (_req, res) => {
    res.json({ status: 'ready' });
  });
  // POST is JSON-RPC; GET and DELETE are answered 405 by the SDK (no standalone stream, no sessions).
  app.all('/mcp', hostHeaderValidation(allowedHosts), express.json({ limit: '1mb' }), (req, res) => {
    void nodeHandler(req, res, req.body);
  });

  const httpServer = app.listen(port, '0.0.0.0', () => console.log(`listening on :${port}`));
  return {
    close: async () => {
      await mcpHandler.close();
      httpServer.close();
    },
  };
}

const server = startMcpHttpServer({
  buildServer,
  port: Number(process.env.PORT ?? 3001),
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0),
});
process.on('SIGTERM', () => {
  void server.close();
});
```

Proof: `PORT=4000 MCP_ALLOWED_HOSTS=localhost,127.0.0.1,mcp-woocommerce.mcp.svc.cluster.local node --no-warnings adr/snippet-2.ts` printed `listening on :4000`. Then:

- `curl -X POST localhost:4000/mcp` with an `initialize` body:
  - with `Host: mcp-woocommerce.mcp.svc.cluster.local:3001` (listed) → `200`;
  - with `Host: mcp-woocommerce:3001` (not listed) → `403 {"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: mcp-woocommerce"},"id":null}`.
- `curl localhost:4000/healthz` with `Host: 10.42.0.15:3001` → `200`.
- `GET /mcp` → `405`; `DELETE /mcp` → `405`; `GET /readyz` → `200`.
- Snippet 5, the v1 SDK client (`ping`/`add`) and Inspector (`--protocol-era legacy` and `modern`, `tools/call ping`) all passed against it.
- The SIGTERM handler was typechecked but not exercised (not run; on Windows `SIGTERM` cannot be delivered to a handler).

### 4. Gateway: dynamic tools (raw JSON Schema), custom `tools/list` + `tools/call`, unchanged passthrough

```ts
import express from 'express';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, createMcpHandler, type Tool } from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';

const PREFIX = 'woo__';
const UPSTREAM_URL = process.env.UPSTREAM_URL ?? 'http://localhost:3001/mcp';
// Drop empty entries ("a,,b" or a trailing comma) and lowercase: the SDK compares the lowercase hostname.
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
  .split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
if (allowedHosts.length === 0) throw new Error('MCP_ALLOWED_HOSTS lists no host');

// Long-lived upstream client; concurrent callTool calls are multiplexed on it.
const upstream = new Client({ name: 'mcp-gateway', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
await upstream.connect(
  new StreamableHTTPClientTransport(new URL(UPSTREAM_URL), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.UPSTREAM_TOKEN ?? 'dev-token'}` } },
  }),
);

// Catalog learned at runtime. The factory reads it on every request, so a refresh applies immediately.
let catalog: Tool[] = [];
async function refreshCatalog(): Promise<void> {
  const { tools } = await upstream.listTools(undefined, { cacheMode: 'refresh' });
  catalog = tools.map((t) => ({ ...t, name: `${PREFIX}${t.name}` })); // raw JSON Schemas pass through untouched
}
await refreshCatalog();

// McpServer (not the deprecated low-level Server) with raw handlers on its .server:
// no SDK input validation, no unknown-tool rewriting, upstream results returned unchanged.
function buildGatewayServer(): McpServer {
  const mcp = new McpServer({ name: 'mcp-gateway', version: '0.1.0' }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler('tools/list', async () => ({ tools: catalog }));
  mcp.server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args } = request.params;
    const tool = catalog.find((t) => t.name === name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    const result = await upstream.callTool(
      { name: name.slice(PREFIX.length), arguments: args ?? {} },
      { signal: ctx.mcpReq.signal, timeout: 15_000 },
    );
    return mcp.server.projectCallToolResult(result, tool.outputSchema);
  });
  return mcp;
}

const handler = toNodeHandler(createMcpHandler(buildGatewayServer));
const app = express();
app.all('/mcp', hostHeaderValidation(allowedHosts), express.json({ limit: '1mb' }), (req, res) => {
  void handler(req, res, req.body);
});
const port = Number(process.env.PORT ?? 4002);
app.listen(port, '0.0.0.0', () => console.log(`gateway on :${port} with ${catalog.map((t) => t.name).join(', ')}`));
```

Proof: with snippet 2 running on :4000, `UPSTREAM_URL=http://localhost:4000/mcp PORT=4002 node --no-warnings adr/snippet-4.ts` printed `gateway on :4002 with woo__ping, woo__add, woo__fail`. Then:

- `gw-test.ts` ran with the v2 client in `legacy` and `auto` modes:
  - `woo__add {a:20,b:22}` → `{"sum":42}`;
  - `woo__fail` → `isError: true` with the upstream text;
  - `woo__nope` → `isError: true` (`Unknown tool: woo__nope`);
  - the upstream `inputSchema` arrived unchanged.
- Inspector legacy `tools/call woo__ping message=hi` → `{"reply":"pong hi"}`.
- The v1 SDK client got `tools/list` → `woo__ping, woo__add, woo__fail`.
- The catalog refresh and the exact-passthrough properties were proven with the same route in `gw-compare.ts` (see "Gateway server route").

### 4b. Fallback: `McpServer.registerTool` + `fromJsonSchema` (raw JSON Schema, optional pass-through validation)

```ts
import express from 'express';
import {
  McpServer, createMcpHandler, fromJsonSchema,
  type JsonSchemaType, type JsonSchemaValidator, type Tool, type jsonSchemaValidator,
} from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';

// Tools known only at runtime, with raw JSON Schemas.
const catalog: Tool[] = [
  {
    name: 'echo__say',
    description: 'Echoes text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

// Accepts every input, so an upstream can report bad arguments itself.
// Drop the second fromJsonSchema argument to validate locally with the SDK's default validator.
const passThrough: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

function buildServer(): McpServer {
  const server = new McpServer({ name: 'dynamic-tools', version: '0.1.0' });
  for (const tool of catalog) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType, passThrough),
      },
      async (args) => ({
        content: [{ type: 'text', text: `said: ${String(args.text)}` }],
        structuredContent: { said: args.text ?? null },
      }),
    );
  }
  return server;
}

// Drop empty entries ("a,,b" or a trailing comma) and lowercase: the SDK compares the lowercase hostname.
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
  .split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
if (allowedHosts.length === 0) throw new Error('MCP_ALLOWED_HOSTS lists no host');
const handler = toNodeHandler(createMcpHandler(buildServer));
const app = express();
app.all('/mcp', hostHeaderValidation(allowedHosts), express.json({ limit: '1mb' }), (req, res) => {
  void handler(req, res, req.body);
});
const port = Number(process.env.PORT ?? 4003);
app.listen(port, '0.0.0.0', () => console.log(`dynamic-tools on :${port}`));
```

Proof: `PORT=4003 node --no-warnings adr/snippet-4b.ts` printed `dynamic-tools on :4003`. Then:

- `client-v2.ts http://localhost:4003/mcp <legacy|auto> dynamic`:
  - `echo__say {text:"hello"}` → `{"said":"hello"}`;
  - an unknown tool → `ProtocolError -32602 Tool nope not found`.
- The v1 SDK client: `echo__say` → `{"said":"hello"}`.
- `passthrough-check.ts`: `echo__say {text:42, extra:true}` → `said: 42`, and `echo__say {}` → `said: undefined`. Both reached the handler with no SDK validation error.

### 5. Client: custom header, `listTools`, `callTool`, errors, timeout/abort, close

```ts
import { Client, StreamableHTTPClientTransport, ProtocolError, SdkError, SdkErrorCode } from '@modelcontextprotocol/client';

const url = new URL(process.argv[2] ?? 'http://localhost:3001/mcp');

const client = new Client(
  { name: 'mcp-gateway', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } }, // probe server/discover, fall back to 2025 initialize
);
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: 'Bearer x' } }, // sent on every request
});

await client.connect(transport, { timeout: 5000 });
console.log(`era=${client.getProtocolEra()} version=${client.getNegotiatedProtocolVersion()}`);

const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));

const ok = await client.callTool({ name: 'add', arguments: { a: 2, b: 3 } }, { timeout: 10_000 });
console.log(ok.isError === true, ok.structuredContent); // false { sum: 5 }

const toolErr = await client.callTool({ name: 'fail', arguments: {} });
console.log(toolErr.isError === true, toolErr.content); // true [ { type: 'text', text: 'WooCommerce returned 503' } ]

const badArgs = await client.callTool({ name: 'add', arguments: { a: 'two' } });
console.log(badArgs.isError === true); // true: McpServer turns input validation failures into isError results

try {
  await client.callTool({ name: 'no_such_tool', arguments: {} });
} catch (err) {
  if (err instanceof ProtocolError) console.log(`protocol error ${err.code}: ${err.message}`); // -32602
}

// Per-call timeout and/or caller abort (e.g. the gateway's own request signal).
// This demo passes an ALREADY-aborted signal so it is deterministic. A mid-call abort
// (AbortController.abort() 300 ms into a 3 s call) was run separately in abort-test.ts.
// Both cases reject with SdkError code REQUEST_TIMEOUT; an abort's message contains 'AbortError'.
try {
  await client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }, { timeout: 10_000, signal: AbortSignal.abort() });
} catch (err) {
  if (err instanceof SdkError && err.code === SdkErrorCode.RequestTimeout) console.log(`timed out or aborted: ${err.message}`);
}

await client.close();
```

Proof: with snippet 2 on :4000, `node --no-warnings adr/snippet-5.ts http://localhost:4000/mcp` printed:

```text
era=modern version=2026-07-28
[ 'ping', 'add', 'fail' ]
false { sum: 5 }
true [ { type: 'text', text: 'WooCommerce returned 503' } ]
true
protocol error -32602: Tool no_such_tool not found
timed out or aborted: AbortError: This operation was aborted
```

Mid-call evidence comes from `abort-test.ts` and `client-v2.ts` in the spike:

- `AbortController.abort()` at 300 ms on a 3 s tool → rejected after about 315 ms, `SdkError REQUEST_TIMEOUT "AbortError: This operation was aborted"`, in both `legacy` and `auto`.
- `{ timeout: 500 }` → rejected after about 502 ms, `"Request timed out"`.
- `AbortSignal.timeout(700)` → rejected after about 701–717 ms, `"TimeoutError: The operation was aborted due to timeout"`.
- The next call on the same client succeeded.

### 6. Inspector CLI (2.11.0) commands that worked

`--header "Name: Value"` exists. `--protocol-era legacy|auto|modern` also exists, and ad-hoc URL runs default to `legacy`. Source: `npx -y @modelcontextprotocol/inspector@2.11.0 --cli --help`.

```bash
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --method tools/list
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --method tools/call --tool-name ping --tool-arg message=hi
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --header "Authorization: Bearer x" --method tools/call --tool-name add --tool-arg a=2 b=3
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --protocol-era modern --header "Authorization: Bearer x" --method tools/call --tool-name add --tool-arg a=2 b=3
```

All four ran exactly as written, via `npx -y`, against snippet 2 on :4000. They returned:

- the `ping, add, fail` tool list;
- `{"reply":"pong hi"}`;
- `{"sum":5}`;
- `{"sum":5}` plus `_meta` serverInfo, for the modern run.

The earlier spike runs used a local install of the same 2.11.0 (`npx --no-install mcp-inspector --cli …`) with the same arguments.

- Several `--tool-arg` pairs follow one flag (`a=2 b=3`), and numbers are sent as numbers (`structuredContent {"sum":5}`).
- Mode flags (`--cli`) must come before the other options.

## Revisit if

- Claude Code, Cursor (first verified in Phase 3) or another required client fails against `createMcpHandler`'s legacy fallback. That includes clients that need a session id or the GET SSE stream.
- The SDK removes the stateless legacy fallback or changes the `legacy` default.
- A 2.x release removes `McpServer.server` or changes `setRequestHandler`. Switch the gateway to snippet 4b with the pass-through validator.
- v1 clients disappear, at which point `legacy: 'reject'` becomes an option.
