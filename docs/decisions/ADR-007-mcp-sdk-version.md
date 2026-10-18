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

**Limitation:** the `claude` CLI is not on PATH on the spike machine. The v1 client (`@modelcontextprotocol/sdk` 1.32.1, which speaks `2025-11-25`) and the Inspector in its default `legacy` era stand in for "current older clients". Claude Code itself is verified against the gateway in Phase 3.

## Decision

- **Use v2 for every component**, with these exact versions:

  | Package | Version | Role |
  |---|---|---|
  | `@modelcontextprotocol/server` | 2.3.1 | `McpServer`, low-level `Server`, `createMcpHandler` |
  | `@modelcontextprotocol/client` | 2.3.1 | gateway → upstream client |
  | `@modelcontextprotocol/express` | 2.0.2 | `createMcpExpressApp` (JSON body parser, Host/Origin validation) |
  | `@modelcontextprotocol/node` | 2.1.1 | `toNodeHandler` (Node `req`/`res` ↔ web `Request`/`Response`); pulls in `hono` 4.13.13 and `@hono/node-server` 1.19.17 |
  | `zod` | 4.6.7 | tool input/output schemas |
  | `express` | 5.3.0 | HTTP app |

- **Serve HTTP with `createMcpHandler(factory)`, mounted through `toNodeHandler`.** The default `legacy: 'stateless'` posture serves 2026-07-28 clients on the modern path. It also answers 2025-era clients (`initialize` handshake) with a fresh stateless instance per request. One endpoint therefore serves both eras from one tool definition. GET and DELETE on `/mcp` get `405`.
- **Do not** use `NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (the example in the express/node READMEs). It serves the 2025 era only (see matrix).
- **Do not** use `legacy: 'reject'`. It locks out every 2025-era client.
- **Clients set `versionNegotiation: { mode: 'auto' }`.** The v2 `Client` defaults to `'legacy'`, the plain 2025 handshake. `'auto'` probes `server/discover` and falls back to `initialize`, so the gateway can reach both v2 and v1 upstreams. Pinning `{ pin: '2026-07-28' }` fails against any 2025-era server.
- Every MCP server still exposes **`POST /mcp`** for JSON-RPC, plus `GET /healthz` (liveness) and `GET /readyz` (readiness).

**Why v2:** all three required clients worked against a v2 server: (a) the Inspector CLI, (b) the v2 client and (c) the v1 client. Each one listed tools and called a tool with `structuredContent`. The v1 client works because of the built-in stateless legacy fallback (decision gap 1: "if v2 can serve both v1 and v2 clients, choose v2"). v1 was therefore not needed, and the v1-only re-run of Steps 2–3 was skipped.

## Compatibility matrix

"Pass" means connect, `tools/list`, and `tools/call` returning the expected `content` and `structuredContent`. Each run sent `Authorization: Bearer x`, and the server log confirmed it was received (scheme logged, value redacted).

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

- Legacy clients (v1, Inspector legacy) issue `GET /mcp` for a standalone stream after `initialize`. They receive `405 {"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}` and continue normally.
- A mini gateway (snippet 4: low-level `Server` + v2 client proxying to a v2 upstream with `woo__` prefixes) passed with the v2 client in both `legacy` and `auto` mode. Over it, `tools/list` worked with the v1 client and `tools/call woo__ping` worked with the Inspector.

## Alternatives considered

- **v1 (`@modelcontextprotocol/sdk` 1.32.1) stateless for everything.** It works with v1 clients, the Inspector legacy era and the v2 client in `legacy`/`auto`. It cannot serve 2026-07-28 clients (Inspector `modern` and v2 `pin` both fail), and it is the older line. Rejected because v2 serves both eras.
- **v2 with `NodeStreamableHTTPServerTransport` per request** (the README example). It serves the 2025 era only. Rejected.
- **v2 `legacy: 'reject'` (modern only).** It breaks every 2025-era client, including today's Inspector default and the v1 client. Rejected.
- **v1 with stateful sessions.** Rejected as before: sessions need affinity or shared state across gateway replicas.
- **Mixing versions per component.** Rejected: more moving parts, and `packages/shared` should use one SDK.

## Consequences/trade-offs

- **Stateless everywhere.** `createMcpHandler` calls the factory once per HTTP request, so no MCP session state exists. This suits a multi-replica gateway, and its per-request `tools/list` can be built from the cached catalog (ADR-014).
- **One extra package.** `@modelcontextprotocol/node` 2.1.1 is needed for `toNodeHandler`, because `@modelcontextprotocol/express` does not include an MCP transport. It brings `hono` and `@hono/node-server` as transitive dependencies.
- **Error shapes clients see** (verified):
  - A tool returning `isError: true` reaches the client as a normal result with `isError: true`.
  - Invalid arguments to an `McpServer` tool also come back as an `isError: true` result (`"Input validation error: Invalid arguments for tool add: a: Invalid input: expected number, received string, …"`), not as a JSON-RPC error.
  - An unknown tool on `McpServer` throws `ProtocolError` code `-32602` (`Tool nope not found`).
  - A client `timeout` or an aborted `signal` both reject with `SdkError` code `REQUEST_TIMEOUT`. An abort's message is `AbortError: This operation was aborted`; `AbortSignal.timeout()` gives `TimeoutError: …`. The connection stays usable afterwards.
- **The low-level `Server` class is marked `@deprecated`** in 2.3.1 typings ("only use for advanced use cases"). It still works, and it is the only way to own `tools/call` fully, so the gateway uses it.
  - `@typescript-eslint/no-deprecated` may flag it. Use one scoped `eslint-disable-next-line` with a reason.
  - Alternative (verified): `McpServer.registerTool(name, { inputSchema: fromJsonSchema(rawJsonSchema as JsonSchemaType) }, cb)`. It also takes raw JSON Schema, but the SDK validates input with it and owns unknown-tool errors.
- **`Tool['inputSchema']` is not directly assignable to `JsonSchemaType`** for `fromJsonSchema`, so a cast is required (seen in the spike).
- **Proxied results carry upstream `_meta`.** On the 2026-07-28 era, a pass-through result includes `_meta["io.modelcontextprotocol/serverInfo"]` naming the upstream. Phase 3 should decide whether to strip or overwrite it.
- **`createMcpExpressApp` defaults:**
  - It binds `127.0.0.1` with Host/Origin validation unless told otherwise.
  - With `host: '0.0.0.0'`, Host validation applies only if `allowedHosts` is given. In the cluster, `allowedHosts` must list the Service DNS names, or must be omitted. This is expected but not tested in-cluster.
  - The JSON body limit defaults to Express's `100kb` (`jsonLimit` option).
- **TypeScript 6 needs `"types": ["node"]`** in `tsconfig.json` (stated in the server/client READMEs; the spike used it).
- Running `.ts` directly on Node 24.0.1 (type stripping) prints an `ExperimentalWarning`. The real build compiles with `tsc`, so this only affected the spike.

## API cheat sheet

Every snippet below was typechecked (`tsc` 6.0.3, `strict`, `noUncheckedIndexedAccess`, `module`/`moduleResolution` `NodeNext`, `types: ["node"]`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) and run on Node 24.0.1 against the packages in the table above. The comments show the output that was observed.

### 1. Imports

```ts
import { z } from 'zod';
import { McpServer, Server, createMcpHandler, fromJsonSchema, type CallToolResult, type JsonSchemaType, type Tool } from '@modelcontextprotocol/server';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Client, StreamableHTTPClientTransport, ProtocolError, SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
```

### 2 + 3. Server: zod 4 tools, `structuredContent`, `isError`, stateless Streamable HTTP on Express 5

```ts
// One fresh McpServer per HTTP request (the factory is called by createMcpHandler).
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

// Modern (2026-07-28) + legacy (2025-era, stateless) on the same endpoint.
const mcpHandler = createMcpHandler(buildServer, {
  onerror: (err) => console.error(`mcp error: ${err.message}`),
});
const nodeHandler = toNodeHandler(mcpHandler);

// host 0.0.0.0 for a pod; allowedHosts keeps Host-header validation on.
const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: ['localhost', '127.0.0.1'] });
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});
app.get('/readyz', (_req, res) => {
  res.json({ status: 'ready' });
});
// POST is JSON-RPC; GET and DELETE are answered 405 by the SDK (no standalone stream, no sessions).
app.all('/mcp', (req, res) => {
  void nodeHandler(req, res, req.body);
});

const port = Number(process.env.PORT ?? 4000);
const httpServer = app.listen(port, '0.0.0.0', () => console.log(`listening on :${port}`));
process.on('SIGTERM', () => {
  void mcpHandler.close().finally(() => httpServer.close());
});
```

Observed results:

- `GET /mcp` → `405`, and `DELETE /mcp` → `405`. Both return the body `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}`.
- `GET /readyz` → `200`.
- The SIGTERM handler was typechecked but not exercised (not run).

### 4. Low-level dynamic tools: raw JSON Schema, custom `tools/list` + `tools/call` (mini gateway)

```ts
const PREFIX = 'woo__';
const upstream = new Client({ name: 'mcp-gateway', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
await upstream.connect(new StreamableHTTPClientTransport(new URL('http://localhost:4000/mcp'), {
  requestInit: { headers: { Authorization: 'Bearer upstream-credential' } },
}));

// Learned at runtime; raw JSON Schemas pass through untouched.
const catalog: Tool[] = (await upstream.listTools()).tools.map((t) => ({ ...t, name: `${PREFIX}${t.name}` }));

function buildGatewayServer(): Server {
  const server = new Server({ name: 'mcp-gateway', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler('tools/list', async () => ({ tools: catalog }));
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args } = request.params;
    const tool = catalog.find((t) => t.name === name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    const result = await upstream.callTool(
      { name: name.slice(PREFIX.length), arguments: args ?? {} },
      { signal: ctx.mcpReq.signal, timeout: 15_000 },
    );
    return server.projectCallToolResult(result, tool.outputSchema);
  });
  return server;
}

const handler = toNodeHandler(createMcpHandler(buildGatewayServer));
const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: ['localhost', '127.0.0.1'] });
app.all('/mcp', (req, res) => {
  void handler(req, res, req.body);
});
app.listen(4002, '0.0.0.0', () => console.log(`gateway on :4002 with ${catalog.map((t) => t.name).join(', ')}`));
```

Observed:

- The gateway logged `gateway on :4002 with woo__ping, woo__add, woo__fail`.
- With the v2 client (`legacy` and `auto`):
  - `woo__add {a:20,b:22}` → `structuredContent {"sum":42}`.
  - `woo__fail` → `isError: true` with the upstream text.
  - `woo__nope` → `isError: true`, `Unknown tool: woo__nope`.
  - The upstream `inputSchema` arrived byte-for-byte.
- `projectCallToolResult` is what the SDK's own `McpServer` uses. It appends text content for `structuredContent` and wraps non-object structured content on the 2025 era.

Alternative for dynamic tools without the deprecated `Server` class (verified with the v2 client in both eras and with the v1 client):

```ts
function buildJsonSchemaServer(): McpServer {
  const server = new McpServer({ name: 'spike-v2-jsonschema', version: '0.0.1' });
  for (const tool of dynamicCatalog) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType) },
      async (args) => ({ content: [{ type: 'text', text: `said: ${String(args.text)}` }], structuredContent: { said: args.text ?? null } }),
    );
  }
  return server;
}
```

### 5. Client: custom header, `listTools`, `callTool`, errors, timeout/abort, close

```ts
const url = new URL(process.argv[2] ?? 'http://localhost:4000/mcp');

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
// Both reject with SdkError code REQUEST_TIMEOUT; an abort's message contains 'AbortError'.
try {
  await client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }, { timeout: 10_000, signal: AbortSignal.abort() });
} catch (err) {
  if (err instanceof SdkError && err.code === SdkErrorCode.RequestTimeout) console.log(`timed out or aborted: ${err.message}`);
}

await client.close();
```

Observed output against snippet 2+3:

```text
era=modern version=2026-07-28
[ 'ping', 'add', 'fail' ]
false { sum: 5 }
true [ { type: 'text', text: 'WooCommerce returned 503' } ]
true
protocol error -32602: Tool no_such_tool not found
timed out or aborted: AbortError: This operation was aborted
```

Other client facts seen in the spike:

- `{ timeout: 500 }` on a 3 s tool rejected after about 502 ms with `SdkError REQUEST_TIMEOUT "Request timed out"`.
- An `AbortController` aborted mid-call at 300 ms rejected after about 315 ms with `REQUEST_TIMEOUT "AbortError: This operation was aborted"`, in both eras.
- The next call on the same client succeeded.

### 6. Inspector CLI (2.11.0) commands that worked

`--header "Name: Value"` exists. `--protocol-era legacy|auto|modern` also exists, and ad-hoc URL runs default to `legacy`. Source: `npx -y @modelcontextprotocol/inspector@2.11.0 --cli --help`.

```bash
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --method tools/list
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --method tools/call --tool-name ping --tool-arg message=hi
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --header "Authorization: Bearer x" --method tools/call --tool-name add --tool-arg a=2 b=3
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --protocol-era modern --header "Authorization: Bearer x" --method tools/call --tool-name add --tool-arg a=2 b=3
```

Notes on these runs:

- Several `--tool-arg` pairs follow one flag (`a=2 b=3`), and numbers are sent as numbers (`structuredContent {"sum":5}`).
- The third and fourth commands were run from a local install of the same 2.11.0 (`npx --no-install mcp-inspector --cli …`), so the arguments are identical.
- Mode flags (`--cli`) must come before the other options.

## Revisit if

- Claude Code (verified in Phase 3) or another required client fails against `createMcpHandler`'s legacy fallback.
- The SDK removes the stateless legacy fallback or changes the `legacy` default.
- The low-level `Server` class is removed (switch the gateway to `McpServer` + `fromJsonSchema`).
- v1 clients disappear, at which point `legacy: 'reject'` becomes an option.
