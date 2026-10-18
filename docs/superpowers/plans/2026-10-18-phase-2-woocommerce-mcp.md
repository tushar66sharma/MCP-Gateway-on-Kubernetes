# Phase 2 — WooCommerce MCP Server: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship our own WooCommerce MCP server.
- It speaks MCP over Streamable HTTP.
- It exposes six tools: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status` and `ping`.
- It talks to the store through the WooCommerce REST API v3, using OAuth 1.0a signing.
- It runs in the cluster's `mcp` namespace as an internal-only service, protected by a bearer token.
- It is built and deployed by the same one-command flow (`up.ps1`).

**Architecture:**
- **TypeScript monorepo.**
  - `packages/shared` holds the reusable pieces: logger, env loader, upstream-auth middleware and a stateless MCP HTTP server bootstrap.
  - `apps/mcp-woocommerce` holds the OAuth1 signer, the WooCommerce client, period resolution and the tool definitions.
  - Tool logic is plain functions over a `WooApi` interface, and only a thin adapter touches the MCP SDK. Tests therefore don't depend on SDK internals.
- **Store access.** The server calls `http://wordpress.store.svc.cluster.local/wp-json/wc/v3/...`. It signs with the public store URL with its scheme forced to `http` (ADR-005).
- **Container image.** It comes from one shared Dockerfile and gets a unique tag on every build.

**Tech Stack:**
- Node 24, TypeScript 6.0.3, Express 5.3.0, zod 4.6.7, pino 10.4.0
- Vitest 5.0.5, ESLint 10.13.0 + typescript-eslint 8.71.2
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server`/`client` 2.3.1, `@modelcontextprotocol/express` 2.0.2, `@modelcontextprotocol/node` 2.1.1), served via `createMcpHandler` + `toNodeHandler`; decided in Task 2.1 (ADR-007)
- `node:24-alpine`, Helm 4.3.1, k3d

**Master plan:** [`2026-10-18-mcp-gateway-implementation-plan.md`](2026-10-18-mcp-gateway-implementation-plan.md), Phase 2 plus "Carry-forward issues → Phase 2". The mapping table at the end shows where each carry-forward item is resolved.

## Global Constraints

- **Branch** `phase-2-woocommerce-mcp`.
  - Commit after every task, and often more than once per task.
  - **Never push.**
  - **No `Co-Authored-By` / Claude / AI attribution** in commits.
  - Use conventional prefixes.
- **Root path** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes`. The path contains spaces, so quote it.
- **Line endings:** LF, except `*.ps1` (CRLF).
- **TypeScript:**
  - `strict: true` and `noUncheckedIndexedAccess`.
  - ESM (`"type": "module"`, `module`/`moduleResolution` `NodeNext`, `.js` extensions in relative imports).
  - No `any` without an `// eslint-disable-next-line` and a reason.
- **Pinned versions**, exact with no caret, added via `npm install -E`:
  - typescript `6.0.3`, vitest `5.0.5`, @types/node `24.19.2`
  - eslint `10.13.0`, @eslint/js `10.0.1`, typescript-eslint `8.71.2`
  - zod `4.6.7`, express `5.3.0`, pino `10.4.0`
  - MCP packages exactly as ADR-007 records
- **No secrets in output.**
  - Logs, errors, test output and script output must never contain the consumer secret, the bearer token, the consumer key, or a full signed URL. A signed URL contains `oauth_signature` and `oauth_consumer_key`.
  - Scripts print the command that fetches a secret, never the secret itself, except with `-Show`.
- **WooCommerce requests are never retried automatically.** A retry would reuse a nonce, and `create_product` is not idempotent. The per-request timeout is `WOO_TIMEOUT_MS`, default 10000.
- **Tool names** must match `^[a-z_]{1,40}$`. The gateway later prefixes them with `woo__`, so the full name stays at most 64 characters.
- **Tool descriptions must be short**, at most about 200 characters each. Groq's free tier allows 8K tokens per minute, and every tool description is sent to the model.
- **Kubernetes workloads.**
  - Probes are `/healthz` and `/readyz`.
  - Requests are 20m/64Mi; limits are 200m/160Mi.
  - Pods run as non-root uid 1000 (`node`) with `readOnlyRootFilesystem: true` and a `/tmp` emptyDir.
  - Every pod sets `automountServiceAccountToken: false`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]` and seccomp `RuntimeDefault`.
- **`/readyz` must not depend on WooCommerce or on the setup Job.** On a fresh install, `--wait` would otherwise deadlock.
- **The MCP server has no Ingress.** It is reachable only inside the cluster (ClusterIP). NetworkPolicies come in Phase 5.
- **Docs.** `docs/run-guide.md` gets a WooCommerce MCP server section. Every doc states only what was verified, and labels the rest expected or not tested.
- **Verification commands.**
  - Tests: `npm test`. It works from Task 2.2 onwards, once workspaces exist.
  - Type checks: `npm run typecheck`.
  - Lint: `npm run lint`.
  - Charts: `helm lint charts/urumi-platform -f deploy/values-local.yaml`.

## File map

| Path | Responsibility | Task |
|---|---|---|
| `docs/decisions/ADR-007-*.md` | SDK decision plus an exact-API cheat sheet that later tasks copy | 2.1 |
| `package.json` (root), `eslint.config.js`, `tsconfig.base.json` | Dev tooling, root scripts | 2.2 |
| `packages/shared/src/{index,logger,env,upstreamAuth,mcpHttpServer}.ts` + `test/` | Reusable server plumbing | 2.2 |
| `apps/mcp-woocommerce/src/woo/{oauth1,errors,client,period}.ts` + `test/` | Store access | 2.3 |
| `apps/mcp-woocommerce/src/tools/*.ts`, `src/{config,server,main}.ts` + `test/` | Tools and entrypoint | 2.4 |
| `charts/urumi-platform/files/store-setup/*`, `templates/_helpers.tpl`, store templates | Least-privilege key owner, atomic upsert, `urumi.podLabels` | 2.5 |
| `docker/node-app.Dockerfile`, `.dockerignore`, `scripts/build-images.ps1`, `scripts/up.ps1`, `scripts/deploy.ps1`, `templates/mcp/*`, values | Image and in-cluster deployment | 2.6 |
| `scripts/check-mcp-woocommerce.ps1`, `scripts/dev/mcp-smoke.mjs`, `scripts/get-secret.ps1` | End-to-end check through the real MCP server | 2.6 |
| `docs/…` | Run guide, workflows, learning notes, ADRs, plan ticks | 2.7 |

---

### Task 2.1: MCP SDK compatibility gate and API cheat sheet (spike)

**Files:**
- Modify: `docs/decisions/ADR-007-*.md` (exact filename in `docs/decisions/`)
- Scratch only: spike code goes in the session scratchpad or a temp folder **outside the repo**, never committed

**Why:** the SDK's v2 line implements the 2026-07-28 spec, where Streamable HTTP is stateless. We must prove two things before building on it:
- a v2 server works with today's clients;
- the v2 client works, because the gateway needs it.

We also need the exact API, so that Tasks 2.2–2.4 and Phase 3 copy working code instead of guessing.

- [ ] **Step 1: Build a minimal v2 server** in a scratch folder with `npm init -y` and `npm i -E @modelcontextprotocol/server@2.3.1 @modelcontextprotocol/express@2.0.2 express@5.3.0 zod@4.6.7`. It needs:
  - stateless Streamable HTTP at `POST /mcp` on port 4000;
  - one tool `ping`, with input `{ message?: string }` and output text `pong <message>`, returning `structuredContent`;
  - one tool `add` (`{a:number,b:number}`).

  Use the package READMEs and type definitions in `node_modules/@modelcontextprotocol/*` as the source of truth.

- [ ] **Step 2: Test it with three clients.**
  - **(a) MCP Inspector CLI.** Run `npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://localhost:4000/mcp --transport http --method tools/list`, then `--method tools/call --tool-name ping --tool-arg message=hi`. Check the Inspector's `--help` for the exact flags and record them.
  - **(b) The v2 client.** Use `@modelcontextprotocol/client@2.3.1` to connect, list tools and call `add`.
  - **(c) The v1 client.** Use `@modelcontextprotocol/sdk@1.32.1` (`Client` + `StreamableHTTPClientTransport`) to connect, list tools and call `ping`. This stands in for current, older clients such as Claude Code, which isn't available on PATH here. Claude Code itself is verified against the gateway in Phase 3.
  - Also test that a custom request header (`Authorization: Bearer x`) can be set on the v2 client transport. The gateway needs this to inject upstream credentials.
  - Test that a per-call timeout or abort can be applied, via an `AbortSignal` or a request option.

- [ ] **Step 3: Low-level server API for the gateway.** Find out how a v2 server can serve **dynamic** tools with raw JSON Schemas (not zod) and custom `tools/list` / `tools/call` handlers. The gateway in Phase 3 proxies tools it learns at runtime. Write a 20-line proof and test it with the v2 client.

- [ ] **Step 4: Decide.**
  - **If (a), (b) and (c) all work → v2.**
  - **Otherwise → v1** (`@modelcontextprotocol/sdk@1.32.1`, `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`). Repeat Steps 2–3 with v1.

- [ ] **Step 5: Update ADR-007.**
  - Set Status to **Accepted (2026-10-18, Phase 2 spike)**.
  - Record the results matrix (which client against which server, pass/fail, with the exact error if any), the chosen packages and their exact versions, and why.
  - Add an **"API cheat sheet"** section with copy-pasteable, verified TypeScript snippets:
    1. Imports.
    2. Creating the server and registering a tool with a zod 4 input schema, including how `structuredContent` and `isError` are returned.
    3. Mounting stateless Streamable HTTP on an Express 5 app at `POST /mcp`, including what GET/DELETE on `/mcp` should return.
    4. The low-level dynamic `tools/list` + `tools/call` handlers.
    5. A client connecting with custom headers, `listTools`, `callTool`, timeout/abort, and close.
    6. The Inspector CLI commands that worked.
  - If v1 wins, update spec §4 to match and say why.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions
git commit -m "docs: finalize MCP SDK choice after client compatibility spike (ADR-007)"
```

---

### Task 2.2: Workspace tooling and `packages/shared`

**Files:**
- Modify: root `package.json` (devDependencies, scripts), `tsconfig.base.json` (if needed)
- Create: `eslint.config.js`, `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`, `packages/shared/src/{index,logger,env,upstreamAuth,mcpHttpServer}.ts`, `packages/shared/test/{env,upstreamAuth,mcpHttpServer}.test.ts`

**Interfaces (produced; later tasks and phases depend on these exact names):**
```ts
// logger.ts
export type Logger = import('pino').Logger;
export function createLogger(name: string, level?: string): Logger;
// redacts: req.headers.authorization, req.headers.cookie, *.authorization, *.password, *.token, *.secret,
//          *.consumerSecret, *.consumerKey, *.credential, and any key ending in "key" or "secret" at depth 1

// env.ts
export class EnvValidationError extends Error { readonly issues: string[] }
export function loadEnv<S extends import('zod').ZodType>(schema: S, env?: NodeJS.ProcessEnv): import('zod').infer<S>;
// the message lists every invalid/missing variable by name; values are NEVER included

// upstreamAuth.ts
export type UpstreamAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'header'; header: string; value: string };
export function upstreamAuthMiddleware(auth: UpstreamAuth): import('express').RequestHandler;
// rejects with HTTP 401, body {"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null};
// bearer kind also sets `WWW-Authenticate: Bearer`. Comparison is constant-time
// (sha256 both sides, then crypto.timingSafeEqual).

// mcpHttpServer.ts
export interface McpHttpServerOptions {
  name: string; version: string; port: number; host?: string;      // host default '0.0.0.0'
  auth: UpstreamAuth; logger: Logger;
  registerTools: (server: SdkMcpServer) => void;                     // SdkMcpServer = the server class per ADR-007
  readinessCheck?: () => Promise<boolean>;                           // default: always ready
}
export interface RunningMcpHttpServer { port: number; close(): Promise<void> }
export function startMcpHttpServer(opts: McpHttpServerOptions): Promise<RunningMcpHttpServer>;
// Routes: POST /mcp (auth → stateless MCP handling, a fresh server+transport per request per ADR-007),
// GET|DELETE /mcp → 405 JSON {"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed"},"id":null},
// GET /healthz → 200 {"status":"ok"}, GET /readyz → 200 {"status":"ready"} | 503 {"status":"not ready"}.
// JSON body limit 1mb. One log line per request: method, path, status, durationMs. No headers, no bodies.
```

- [ ] **Step 1: Root tooling.** From the repo root, run:

```powershell
npm install -D -E typescript@6.0.3 vitest@5.0.5 @types/node@24.19.2 eslint@10.13.0 @eslint/js@10.0.1 typescript-eslint@8.71.2
```

Set the root `package.json` scripts to:

```json
"scripts": {
  "build": "npm run build -w @urumi/shared && npm run build --workspaces --if-present",
  "typecheck": "npm run build -w @urumi/shared && npm run typecheck --workspaces --if-present",
  "test": "npm run test --workspaces --if-present",
  "lint": "eslint ."
}
```

`@urumi/shared` is built first because apps type-check against its `dist/*.d.ts`. Building it twice in `build` is harmless.

- [ ] **Step 2: Write `eslint.config.js`** (root, flat config):

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', 'charts/**', 'docs/**', '.superpowers/**', 'scripts/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

If ESLint 10 rejects `defineConfig(…)` with these arguments, use `tseslint.config(...)` instead, and record the change.

- [ ] **Step 3: Write `packages/shared/package.json`**

```json
{
  "name": "@urumi/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

Then add the runtime dependencies with `-E`: express@5.3.0, pino@10.4.0, zod@4.6.7, plus the MCP server packages from ADR-007. Add these as dev dependencies: @types/express (the latest 5.x), and the MCP client package from ADR-007 (used by the tests).

Configuration files:
- `tsconfig.json` extends `../../tsconfig.base.json` with `"compilerOptions": {"rootDir": ".", "noEmit": true, "types": ["node"]}` and `"include": ["src", "test", "vitest.config.ts"]`.
- `tsconfig.build.json` extends `./tsconfig.json` with `{"compilerOptions": {"noEmit": false, "rootDir": "src", "outDir": "dist"}, "include": ["src"]}`.
- `vitest.config.ts` uses `defineConfig({ test: { include: ['test/**/*.test.ts'] } })`.

- [ ] **Step 4: Write the failing tests first.** Specify them exactly as follows:
  - **`test/env.test.ts`**
    - With the schema `z.object({ PORT: z.coerce.number().int().positive(), TOKEN: z.string().min(16) })` and env `{ PORT: 'abc' }`, the loader throws `EnvValidationError`.
    - Its message contains `PORT` and `TOKEN`, and does NOT contain `abc`.
    - Valid env returns `{ PORT: 3001, TOKEN: '…' }` with PORT coerced to a number.
  - **`test/upstreamAuth.test.ts`**: mount the middleware on an express app listening on port 0, and use `fetch`.
    - Bearer kind:
      - no header → 401, with the exact JSON-RPC body and the `WWW-Authenticate` header;
      - a wrong token → 401;
      - `Bearer <right>` → 200;
      - a lowercase `bearer <right>` is accepted (the scheme is case-insensitive).
    - Header kind (`x-utilities-key`): a missing header → 401; a wrong value → 401; the right value → 200.
    - None kind: 200 without a header.
  - **`test/mcpHttpServer.test.ts`**: start the server on port 0 with a `ping` tool and bearer auth.
    - `/healthz` → 200.
    - `/readyz` → 200; with `readinessCheck: async () => false` → 503.
    - `GET /mcp` → 405.
    - `POST /mcp` with no auth → 401.
    - The SDK client from ADR-007, with the right bearer header, connects. `listTools` contains `ping`, and `callTool('ping')` returns the text.
    - `close()` resolves, after which the port is free.

- [ ] **Step 5: Run the tests and watch them fail:** `npm test -w @urumi/shared`. They should FAIL because the modules don't exist yet.

- [ ] **Step 6: Implement `logger.ts`, `env.ts` and `upstreamAuth.ts`** to the interfaces above:
  - **`env.ts`:** uses `schema.safeParse(env)` and formats the message as `Invalid environment: PORT (expected number), TOKEN (required)`, built from `issue.path` and a short code. It never includes `issue.input`.
  - **`upstreamAuth.ts`:** reads the header case-insensitively and parses `Bearer` case-insensitively.

- [ ] **Step 7: Implement `mcpHttpServer.ts`** using the ADR-007 cheat sheet. Create a fresh SDK server and transport per request (stateless). `index.ts` re-exports everything.

- [ ] **Step 8: Verify.** Run these from the root:
  - `npm test -w @urumi/shared`: all PASS.
  - `npm run build -w @urumi/shared`: `dist/` is created.
  - `npm run typecheck`: 0 errors.
  - `npm run lint`: 0 problems.
  - Also confirm the root `npm test` now works, which resolves the Phase 0 "No workspaces found" note.

- [ ] **Step 9: Commit.** Ensure `dist/` is git-ignored; it already is.

```bash
git add package.json package-lock.json eslint.config.js tsconfig.base.json
git commit -m "build: add TypeScript, Vitest and ESLint workspace tooling"
git add packages/shared
git commit -m "feat(shared): add logger, env loader, upstream auth and stateless MCP HTTP server"
```

---

### Task 2.3: WooCommerce access: OAuth1 signer, client, period resolution

**Files:**
- Create: `apps/mcp-woocommerce/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`, `apps/mcp-woocommerce/src/woo/{oauth1,errors,client,period}.ts`, `apps/mcp-woocommerce/test/{oauth1,client,period}.test.ts`

**Interfaces (produced):**
```ts
// oauth1.ts
export class OAuth1Error extends Error {}
export function buildOAuth1BaseString(method: string, signingUrl: string, params: ReadonlyMap<string, string>): string;
export interface OAuth1SignInput { method: string; url: string; signingBaseUrl: string; consumerKey: string; consumerSecret: string; nonce?: string; timestamp?: number }
export function signOAuth1(input: OAuth1SignInput): URL;   // the request URL (original host) with oauth_* params + oauth_signature added
// errors.ts
export class WooApiError extends Error { constructor(message: string, readonly status: number, readonly code: string) }
// client.ts
export type QueryValue = string | number | boolean | undefined;
export interface WooApi {
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}
export interface WooClientOptions { baseUrl: string; signingBaseUrl: string; consumerKey: string; consumerSecret: string; timeoutMs: number; fetchImpl?: typeof fetch }
export class WooClient implements WooApi { constructor(o: WooClientOptions) }
// period.ts
export type Period = 'today' | 'yesterday' | 'last_7_days';
export const PERIODS: readonly Period[];
export function resolvePeriod(period: Period, timeZone: string, now?: Date): { after: string; before: string }; // UTC ISO strings
```
(This replaces the master plan's `signOAuth1(...) : URLSearchParams` with `signOAuth1(...) : URL`, plus a separate `signingBaseUrl`. The carry-forward requires both.)

- [ ] **Step 1: Write `apps/mcp-woocommerce/package.json`**: name `@urumi/mcp-woocommerce`, `"type": "module"`, and these scripts:
  - `build`: `tsc -p tsconfig.build.json`
  - `typecheck`: `tsc -p tsconfig.json --noEmit`
  - `test`: `vitest run`
  - `start`: `node dist/main.js`

  Dependencies:
  - `"@urumi/shared": "*"` (the workspace link)
  - zod@4.6.7 and the MCP server package (exact versions)

  The tsconfig files mirror the shared package's. `vitest.config.ts` adds `resolve.alias: { '@urumi/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) }`, so tests don't need a prior build.

- [ ] **Step 2: Write the failing tests.**
  - **`test/oauth1.test.ts`:**
    - **Known-answer test.** Copy the PHP-derived vector from `scripts/dev/woo-oauth-check.test.mjs`: the same dummy key/secret, nonce, timestamp, signing base, path and params. Assert `buildOAuth1BaseString(...)` equals the expected base string exactly, and that `signOAuth1(...)` puts the expected `oauth_signature` in the URL.
    - **The signature covers the public URL.** With `url = http://wordpress.store.svc.cluster.local/wp-json/wc/v3/products?per_page=5` and `signingBaseUrl = http://store.localhost`, the result keeps host `wordpress.store.svc.cluster.local`. Its signature equals the one computed for `http://store.localhost/wp-json/wc/v3/products?per_page=5` with the same nonce and timestamp.
    - **Rejected keys:** a duplicate key, a key containing `[`, `]`, `.` or a space, and a caller-supplied `oauth_nonce`. Each throws `OAuth1Error`.
    - A query key `__proto__=1` is signed like any other key, and is neither dropped nor turned into a prototype.
    - The result URL never contains the consumer secret.
  - **`test/client.test.ts`** uses a stub `fetchImpl` that records the request:
    - `get('/products', {per_page: 5, search: undefined})` sends `GET` to `http://wordpress.store.svc.cluster.local/wp-json/wc/v3/products?per_page=5&oauth_…`. There is no `search` key and no consumer secret anywhere in the URL.
    - `post('/products', {name:'Mug'})` sends a JSON body with `content-type: application/json`.
    - A 404 with body `{"code":"woocommerce_rest_shop_order_invalid_id","message":"Invalid ID.","data":{"status":404}}` throws a `WooApiError` with status 404, that code, and message `Invalid ID.`.
    - A 500 with an HTML body throws a `WooApiError` with code `http_500` and a message of at most 200 characters.
    - A 301 throws a `WooApiError` with status 301 (the request uses `redirect: 'manual'`; redirects are never followed, because they would break the signature).
    - A stub that never resolves, with `timeoutMs: 50`, throws a `WooApiError` with code `timeout`.
    - A stub that throws `TypeError('fetch failed')` throws a `WooApiError` with code `network_error`.
    - A 200 with a non-JSON body throws code `bad_response`.
    - None of these error messages contain the consumer key, the consumer secret or `oauth_signature`.
  - **`test/period.test.ts`:**
    - `resolvePeriod('today','Asia/Kolkata', new Date('2026-10-18T20:00:00Z'))` returns `{after:'2026-10-18T18:30:00.000Z', before:'2026-10-19T18:30:00.000Z'}`.
    - `yesterday` returns `{after:'2026-10-17T18:30:00.000Z', before:'2026-10-18T18:30:00.000Z'}`.
    - `last_7_days` returns `{after:'2026-10-12T18:30:00.000Z', before:'2026-10-19T18:30:00.000Z'}` (at 20:00Z it is already 2026-10-19 01:30 in Kolkata, so "today" is the 19th and the 7 days are 13th–19th local).
    - `today` in `UTC` at `2026-10-18T00:00:00Z` returns `{after:'2026-10-18T00:00:00.000Z', before:'2026-10-19T00:00:00.000Z'}`.
    - DST: `today` in `America/New_York` at `2026-11-01T12:00:00Z`, the DST-end day, returns `{after:'2026-11-01T04:00:00.000Z', before:'2026-11-02T05:00:00.000Z'}`.
    - An invalid time zone throws a `RangeError`.

- [ ] **Step 3: Run the tests.** `npm test -w @urumi/mcp-woocommerce` FAILs because the modules are missing.

- [ ] **Step 4: Implement `oauth1.ts`.** This is a port of the Phase 1 reference signer, with `Map` params and reserved-key checks.

```ts
import { createHmac, randomBytes } from 'node:crypto';

/** Thrown for query shapes WooCommerce (PHP) would sign differently, or reserved OAuth keys. */
export class OAuth1Error extends Error {}

/** RFC 3986 percent-encoding, identical to PHP rawurlencode. */
const enc = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// PHP rewrites "." and " " in $_GET keys and parses "[]" as arrays, so such keys would sign differently.
const UNSUPPORTED_KEY = /[[\]. ]/;

function collectQuery(url: URL): Map<string, string> {
  const params = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (UNSUPPORTED_KEY.test(key)) {
      throw new OAuth1Error(`Query key "${key}" is not supported; send lists comma-separated (e.g. include=1,2)`);
    }
    if (key.startsWith('oauth_')) throw new OAuth1Error(`Query key "${key}" is reserved for OAuth`);
    if (params.has(key)) throw new OAuth1Error(`Duplicate query key "${key}"; send lists comma-separated`);
    params.set(key, value);
  }
  return params;
}

/**
 * WooCommerce check_oauth_signature: sort by RAW key in byte order (strcmp), then encode key and value,
 * join with "=" and "&", and build METHOD&enc(baseUri)&enc(normalized).
 */
export function buildOAuth1BaseString(method: string, signingUrl: string, params: ReadonlyMap<string, string>): string {
  const normalized = [...params.entries()]
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  return [method.toUpperCase(), enc(signingUrl), enc(normalized)].join('&');
}

export interface OAuth1SignInput {
  method: string;
  url: string;
  signingBaseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  nonce?: string;
  timestamp?: number;
}

/**
 * Returns the request URL (unchanged host) with OAuth 1.0a one-legged HMAC-SHA256 params.
 * The signature covers signingBaseUrl + path because WooCommerce rebuilds the base URI from
 * get_home_url(), not from the Host header (ADR-005).
 */
export function signOAuth1(input: OAuth1SignInput): URL {
  const target = new URL(input.url);
  const params = collectQuery(target);
  params.set('oauth_consumer_key', input.consumerKey);
  params.set('oauth_nonce', input.nonce ?? randomBytes(16).toString('hex'));
  params.set('oauth_signature_method', 'HMAC-SHA256');
  params.set('oauth_timestamp', String(input.timestamp ?? Math.floor(Date.now() / 1000)));

  const signingUrl = input.signingBaseUrl.replace(/\/+$/, '') + target.pathname;
  const baseString = buildOAuth1BaseString(input.method, signingUrl, params);
  const signature = createHmac('sha256', `${input.consumerSecret}&`).update(baseString).digest('base64');

  const out = new URL(target.origin + target.pathname);
  for (const [k, v] of params) out.searchParams.set(k, v);
  out.searchParams.set('oauth_signature', signature);
  return out;
}
```

- [ ] **Step 5: Implement `errors.ts` and `client.ts`.**

```ts
// errors.ts
/** A failed WooCommerce REST call. Messages never contain credentials or signed URLs. */
export class WooApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'WooApiError';
  }
}
```

```ts
// client.ts
import { signOAuth1 } from './oauth1.js';
import { WooApiError } from './errors.js';

export type QueryValue = string | number | boolean | undefined;

/** What the tools need from WooCommerce; the real client and test fakes implement it. */
export interface WooApi {
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

export interface WooClientOptions {
  baseUrl: string;          // in-cluster, e.g. http://wordpress.store.svc.cluster.local
  signingBaseUrl: string;   // public store URL with scheme http, e.g. http://store.localhost
  consumerKey: string;
  consumerSecret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** WooCommerce REST v3 client. Never retries: a retry would reuse a nonce and could duplicate writes. */
export class WooClient implements WooApi {
  constructor(private readonly o: WooClientOptions) {}

  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', path, query, undefined);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, undefined, body);
  }
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, undefined, body);
  }

  private async request<T>(method: string, path: string, query: Record<string, QueryValue> | undefined, body: unknown): Promise<T> {
    const url = new URL(`/wp-json/wc/v3${path}`, this.o.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const signed = signOAuth1({
      method,
      url: url.toString(),
      signingBaseUrl: this.o.signingBaseUrl,
      consumerKey: this.o.consumerKey,
      consumerSecret: this.o.consumerSecret,
    });
    const doFetch = this.o.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(signed, {
        method,
        redirect: 'manual',
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WooApiError(`WooCommerce did not respond within ${this.o.timeoutMs}ms`, 0, 'timeout');
      }
      throw new WooApiError('Could not reach WooCommerce (network error)', 0, 'network_error');
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const obj = (data ?? {}) as { code?: unknown; message?: unknown };
      const code = typeof obj.code === 'string' ? obj.code : `http_${res.status}`;
      const message = typeof obj.message === 'string' ? obj.message : `HTTP ${res.status}: ${text.slice(0, 120)}`;
      throw new WooApiError(message.slice(0, 200), res.status, code);
    }
    if (data === undefined) throw new WooApiError('WooCommerce returned a non-JSON response', res.status, 'bad_response');
    return data as T;
  }
}
```

The timeout test stub must honor `init.signal`: it rejects with the signal's reason when aborted.

- [ ] **Step 6: Implement `period.ts`.**

```ts
export type Period = 'today' | 'yesterday' | 'last_7_days';
export const PERIODS: readonly Period[] = ['today', 'yesterday', 'last_7_days'];

/** Milliseconds the zone is ahead of UTC at a given instant (e.g. +19800000 for Asia/Kolkata). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight for the given calendar date in the zone (DST-safe). */
function startOfLocalDay(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

function localCalendarDate(instant: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** [after, before) bounds of a period in the store's time zone, as UTC ISO strings. */
export function resolvePeriod(period: Period, timeZone: string, now: Date = new Date()): { after: string; before: string } {
  const { y, m, d } = localCalendarDate(now.getTime(), timeZone);
  const dayStart = (offsetDays: number): number => {
    const date = new Date(Date.UTC(y, m - 1, d + offsetDays));
    return startOfLocalDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), timeZone);
  };
  const iso = (ms: number): string => new Date(ms).toISOString();
  switch (period) {
    case 'today':
      return { after: iso(dayStart(0)), before: iso(dayStart(1)) };
    case 'yesterday':
      return { after: iso(dayStart(-1)), before: iso(dayStart(0)) };
    case 'last_7_days':
      return { after: iso(dayStart(-6)), before: iso(dayStart(1)) };
  }
}
```

- [ ] **Step 7: Run the tests.** All PASS. Also run `npm run typecheck` and `npm run lint` (both clean).
- [ ] **Step 8: Commit**

```bash
git add apps/mcp-woocommerce package.json package-lock.json
git commit -m "feat(woo-mcp): add OAuth1-signed WooCommerce REST client with period resolution"
```

---

### Task 2.4: The six tools and the server entrypoint

**Files:**
- Create: `apps/mcp-woocommerce/src/tools/{types,format,listProducts,createProduct,listOrders,getOrder,updateOrderStatus,ping,index}.ts`, `src/{config,server,main}.ts`, `test/{tools,server}.test.ts`

**Interfaces:**
```ts
// tools/types.ts
export interface ToolDeps { woo: WooApi; storeTimeZone: string; now: () => Date }
export interface ToolResult { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;           // ^[a-z_]{1,40}$
  title: string;
  description: string;    // ≤ ~200 chars
  inputSchema: S;
  handler: (args: z.infer<S>, deps: ToolDeps) => Promise<ToolResult>;
}
// tools/index.ts
export const wooTools: readonly ToolDefinition[];                    // exactly the 6 tools, in the order below
export function registerWooTools(server: SdkMcpServer, deps: ToolDeps): void;  // thin adapter per ADR-007
// format.ts
export function ok(summary: string, data: Record<string, unknown>): ToolResult;   // text = summary + "\n" + JSON.stringify(data, null, 2)
export function fail(err: unknown): ToolResult;   // WooApiError → "WooCommerce returned <status>: <message>" (status 0 → "WooCommerce request failed (<code>): <message>"); other → "Unexpected error: <message>"; isError: true
```

**Tool contracts.** The REST paths are relative to `/wp-json/wc/v3`. Descriptions stay short.

| Tool | Input (zod) | WooCommerce call | Result `structuredContent` |
|---|---|---|---|
| `list_products` | `search?` string ≤100; `status?` enum `publish\|draft\|pending\|private\|any` (default `any`); `page?` int ≥1 (default 1); `per_page?` int 1–50 (default 20) | `GET /products` with those (omit `status=any`) | `{ products: ProductSummary[], page, per_page }` |
| `create_product` | `name` string 1–200; `regular_price` string matching `^\d+(\.\d{1,2})?$`; `description?` ≤2000; `status?` `publish\|draft` (default `publish`) | `POST /products` `{ name, type:'simple', regular_price, description, status }` | `{ product: ProductSummary }` (summary text includes the permalink) |
| `list_orders` | `period?` enum of `PERIODS`; `after?`/`before?` ISO datetime strings; `status?` enum (see below) or `any` (default `any`); `page?`; `per_page?` 1–50 (default 20). Reject giving `period` together with `after`/`before`. | `GET /orders` with `after`,`before` (from `resolvePeriod(period, storeTimeZone, now())` when `period` is set), `dates_are_gmt=true`, `status`, `page`, `per_page`, `orderby=date`, `order=desc` | `{ orders: OrderSummary[], range?: {after,before,timeZone}, page, per_page }` |
| `get_order` | `order_id` int ≥1 | `GET /orders/{id}` | `{ order: OrderDetail }` |
| `update_order_status` | `order_id` int ≥1; `status` enum `pending\|processing\|on-hold\|completed\|cancelled\|refunded\|failed` | `PUT /orders/{id}` `{ status }` | `{ order: OrderSummary, previous_status? }` (previous status is not fetched; omit it) |
| `ping` | `{}` | none | `{ ok: true, server: 'mcp-woocommerce', time: ISO }` |

**Shapes:**
- `ProductSummary = { id, name, status, price, regular_price, stock_status, permalink }`
- `OrderSummary = { id, number, status, currency, total, date_created_gmt, customer: "<billing first> <billing last>", item_count }`
- `OrderDetail` = OrderSummary plus `billing_email`, `payment_method_title`, `line_items: {name, quantity, total}[]`, `date_paid_gmt`

**Descriptions** (use these verbatim; they are short on purpose):
- list_products: "List store products. Optional search text, status filter and paging."
- create_product: "Create a simple product with a name and regular price (e.g. \"12.50\"). Published by default."
- list_orders: "List orders, newest first. Use period=today|yesterday|last_7_days (store time zone) or after/before ISO times."
- get_order: "Get one order with items, totals, customer and payment method."
- update_order_status: "Change an order's status (pending, processing, on-hold, completed, cancelled, refunded, failed)."
- ping: "Health check: returns ok and the server time."

**Config (`config.ts`, via `loadEnv`):**
- `PORT` (default 3001)
- `WOO_BASE_URL` (url)
- `WOO_SIGNING_BASE_URL` (url; must start with `http://`, otherwise fail with a clear message)
- `WOO_CONSUMER_KEY` (min 10)
- `WOO_CONSUMER_SECRET` (min 10)
- `MCP_AUTH_TOKEN` (min 16)
- `STORE_TIMEZONE` (default `UTC`; validated by `new Intl.DateTimeFormat('en-US', {timeZone})`)
- `WOO_TIMEOUT_MS` (default 10000, 1000–60000)
- `LOG_LEVEL` (default `info`)

**`main.ts`:**
1. Load the config. On `EnvValidationError`, log only the message and exit with code 1.
2. Create the logger and the `WooClient`.
3. `startMcpHttpServer({ name: 'mcp-woocommerce', version: <package version>, port, auth: { kind: 'bearer', token }, registerTools: (s) => registerWooTools(s, deps), readinessCheck: async () => true })`. Readiness never calls WooCommerce.
4. On SIGTERM/SIGINT, close and exit with code 0.
5. Log at startup: the name, version and port, the WooCommerce base URL and signing base URL (these are not secrets), and the time zone. Never log keys or the token.

- [ ] **Step 1: Write the failing `test/tools.test.ts`.** It uses a fake `WooApi` that records calls and returns fixtures, with `now = () => new Date('2026-10-18T20:00:00Z')`. Cover:
  - `wooTools` has exactly the 6 names, every name matches `^[a-z_]{1,40}$`, and every description is ≤ 200 characters.
  - `list_products` happy path: the fake receives `GET /products` with `per_page: 20` and no `status` key, and the result `structuredContent.products[0]` has exactly the ProductSummary keys.
  - `create_product`:
    - `{name:'Demo Mug', regular_price:'12.50'}` calls POST with `type:'simple'` and `status:'publish'`.
    - `regular_price: '-1'`, `'12.505'` and `'abc'` are rejected by `inputSchema.safeParse`.
  - `list_orders`:
    - `{period:'today'}` with `storeTimeZone 'Asia/Kolkata'` sends `after '2026-10-18T18:30:00.000Z'`, `before '2026-10-19T18:30:00.000Z'` and `dates_are_gmt: true`, and returns a `range`.
    - `{period:'today', after:'…'}` is rejected.
    - An unknown status is rejected.
  - `get_order` maps line items.
  - `update_order_status`:
    - `{order_id: 15, status:'completed'}` calls `PUT /orders/15` with `{status:'completed'}`.
    - `status:'shipped'` is rejected.
  - A fake that throws `new WooApiError('Invalid ID.', 404, 'woocommerce_rest_shop_order_invalid_id')` produces `isError: true` with the text `WooCommerce returned 404: Invalid ID.`.
  - `ping` returns `ok: true`.
- [ ] **Step 2: Write the failing `test/server.test.ts`.** This is an integration test:
  - Start `startMcpHttpServer` on port 0 with `registerWooTools` over the fake `WooApi` and bearer auth.
  - Connect with the ADR-007 client using the bearer header.
  - `listTools` returns the 6 names, each with an input schema.
  - `callTool('list_orders', {period:'today'})` returns structured orders.
  - Calling `create_product` with an invalid price returns an MCP error result or a protocol error (assert whichever ADR-007 documents) and does not crash the server.
- [ ] **Step 3:** Run the tests and confirm they FAIL.
- [ ] **Step 4:** Implement `types.ts`, `format.ts`, one file per tool, `index.ts` (`wooTools` plus the `registerWooTools` adapter, per the ADR-007 cheat sheet), `config.ts`, `server.ts` (it builds deps and calls `startMcpHttpServer`, and is exported for the tests) and `main.ts`.
- [ ] **Step 5:** Run all tests (PASS), typecheck, lint and `npm run build` (produces `apps/mcp-woocommerce/dist/main.js`).
- [ ] **Step 6: Local run against the real store.**
  1. Port-forward WordPress: `kubectl -n store port-forward svc/wordpress 18080:80`.
  2. Export the env vars from the cluster Secrets into the process env without printing them. The pattern is in `scripts/check-woo-api.ps1`. Set `WOO_BASE_URL=http://127.0.0.1:18080`, `WOO_SIGNING_BASE_URL=http://store.localhost`, `MCP_AUTH_TOKEN` to a random value and `STORE_TIMEZONE=Asia/Kolkata`.
  3. Start the server with `node apps/mcp-woocommerce/dist/main.js`.
  4. Call it with the Inspector CLI (exact flags from ADR-007), passing `Authorization: Bearer <random>`: `tools/list` returns 6 tools, and `list_products` returns the store's products.
  5. Record the outputs, with secrets redacted.
- [ ] **Step 7: Commit**

Two commits: first the tools (`src/tools/*`, `test/tools.test.ts`), then the entrypoint (`src/{config,server,main}.ts`, `test/server.test.ts`).

```bash
git add apps/mcp-woocommerce/src/tools apps/mcp-woocommerce/test/tools.test.ts
git commit -m "feat(woo-mcp): add product and order tools with input validation"
git add apps/mcp-woocommerce
git commit -m "feat(woo-mcp): add server entrypoint, config and integration tests"
```

---

### Task 2.5: Store-side hardening for the MCP key (least privilege, atomic upsert, pod labels)

**Files:**
- Modify: `charts/urumi-platform/files/store-setup/setup.sh`, `charts/urumi-platform/files/store-setup/upsert-api-key.php`, `charts/urumi-platform/templates/_helpers.tpl`, `templates/store/mariadb.yaml`, `templates/store/wordpress.yaml`, `templates/store/store-setup.yaml`, `charts/urumi-platform/values.yaml`

**Steps:**
1. **`setup.sh` creates a dedicated key owner.** Add this before the key upsert:
   - If user `urumi-mcp` doesn't exist, run `wp user create urumi-mcp urumi-mcp@example.invalid --role=shop_manager --user_pass="$(head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32)"`. The password is random and never printed. Nobody logs in as this user; it only owns the API key.
   - If the user exists, run `wp user set-role urumi-mcp shop_manager`.
   - Then pass `KEY_OWNER=urumi-mcp` to the PHP.
   - Make the login configurable via `storeSetup.mcpKeyOwner` (default `urumi-mcp`) in `values.yaml`, through a `MCP_KEY_OWNER` env var on the Job.
2. **`upsert-api-key.php` becomes an atomic upsert with the new owner.**
   - Look up the owner by `getenv('MCP_KEY_OWNER')` instead of the admin. Error if the owner is missing or lacks the `manage_woocommerce` capability.
   - Find the existing row by `description`.
   - If it exists, `UPDATE` `user_id`, `permissions='read_write'`, `consumer_key=wc_api_hash(ck)`, `consumer_secret`, `truncated_key`, keeping `key_id`. Otherwise `INSERT`.
   - If more than one row matches (legacy), keep the lowest `key_id` and delete the rest.
   - Never print key material. Print only the truncated key, as today.
3. **Add the `urumi.podLabels` helper to `_helpers.tpl`:**

```
{{/* Pod template labels: selector labels + stable descriptive labels. No chart version, so chart
     version bumps do not restart pods. Args: dict root, name, component. */}}
{{- define "urumi.podLabels" -}}
{{ include "urumi.selectorLabels" (dict "root" .root "name" .name) }}
app.kubernetes.io/part-of: urumi-platform
app.kubernetes.io/component: {{ .component }}
{{- end }}
```

   Use it in the pod templates of mariadb, wordpress and store-setup, replacing `urumi.labels` in `spec.template.metadata.labels`. Selectors stay unchanged. Also add a comment at the top of `_helpers.tpl`: `Never render .Values with toYaml: during rendering .Values.__generated holds generated secrets.`
4. **Verify:**
   - `helm lint` passes.
   - Run `up.ps1 -Redeploy`. MariaDB and WordPress restart once, because their pod labels changed. That is expected; record it.
   - The setup log shows the owner created or present, and `SETUP COMPLETE`.
   - The key's `user_id` belongs to `urumi-mcp`. Check with `kubectl exec deploy/wordpress -c wordpress -- php -r` and `get_user_by('id', …)`; print only the login and role.
   - `scripts\check-woo-api.ps1` still gives 200/200/401.
   - A second `-Redeploy` keeps the same `key_id`, which proves the upsert is atomic.
   - Run `scripts\dev\customer-order-smoke.ps1` again; it should still pass.
5. **Commit:**

```bash
git add charts/urumi-platform
git commit -m "feat(store): own the MCP API key with a least-privilege shop manager and upsert it atomically"
git commit -m "refactor(helm): use version-free pod labels so chart bumps do not restart pods"   # split if practical
```

---

### Task 2.6: Container image, in-cluster deployment and end-to-end check

**Files:**
- Create:
  - `docker/node-app.Dockerfile`, `.dockerignore`
  - `scripts/build-images.ps1`, `scripts/get-secret.ps1`, `scripts/check-mcp-woocommerce.ps1`, `scripts/dev/mcp-smoke.mjs`
  - `charts/urumi-platform/templates/mcp/{mcp-woocommerce.yaml,secrets.yaml}`
- Modify:
  - `charts/urumi-platform/templates/_helpers.tpl` (`urumi.image`, `urumi.storeSigningBaseUrl`, `urumi.storeWooApiData`)
  - `templates/store/store-secrets.yaml` (use `urumi.storeWooApiData`)
  - `values.yaml`, `values.schema.json`, `deploy/values-prod.yaml` (image registry/tag placeholders)
  - `.gitignore` (`deploy/.images.local.yaml`)
  - `scripts/deploy.ps1` (include `deploy/.images.local.yaml` when present)
  - `scripts/up.ps1` (build images before deploying when installing or `-Redeploy`; print an MCP line)
  - `scripts/check-woo-api.ps1` (derive `--sign-base` from the release values, using the same rule as `up.ps1` plus the scheme forced to http)
  - root `package.json` (root devDependency on the ADR-007 client package, for `mcp-smoke.mjs`)

**Helm helpers** (append to `_helpers.tpl`):

```
{{/* Image reference for our own images. Args: dict root, repository, tag (optional). */}}
{{- define "urumi.image" -}}
{{- $g := .root.Values.global -}}
{{- $tag := default $g.imageTag .tag -}}
{{- if $g.imageRegistry -}}
{{- printf "%s/%s:%s" $g.imageRegistry .repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .repository $tag -}}
{{- end -}}
{{- end }}

{{/* Base URL WooCommerce signs OAuth1 requests against: the public store URL with scheme forced to http
     (in-cluster calls are never TLS; WooCommerce uses get_home_url(null, $path, 'http')). ADR-005. Args: root. */}}
{{- define "urumi.storeSigningBaseUrl" -}}
{{- $public := include "urumi.publicUrl" (dict "root" . "host" .Values.global.storeHost) -}}
{{- regexReplaceAll "^https?://" $public "http://" -}}
{{- end }}

{{/* data: block of the store-woo-api Secret. Used for BOTH the store and mcp copies so they always match
     (same canonical namespace, length and prefix). Args: root. */}}
{{- define "urumi.storeWooApiData" -}}
consumer-key: {{ include "urumi.generatedValue" (dict "root" . "namespace" .Values.namespaces.store "secret" "store-woo-api" "key" "consumer-key" "length" 40 "prefix" "ck_") | b64enc | quote }}
consumer-secret: {{ include "urumi.generatedValue" (dict "root" . "namespace" .Values.namespaces.store "secret" "store-woo-api" "key" "consumer-secret" "length" 40 "prefix" "cs_") | b64enc | quote }}
{{- end }}
```

**Values** (append to `values.yaml`; add `imageRegistry` and `imageTag` under `global`):

```yaml
# global:
#   imageRegistry: ""     # e.g. ghcr.io/<user> in production; "" = local images imported into k3d
#   imageTag: dev         # overridden locally by deploy/.images.local.yaml written by scripts/build-images.ps1

mcpWoocommerce:
  enabled: true
  image:
    repository: urumi/mcp-woocommerce
    tag: ""               # "" = global.imageTag
  port: 3001
  timeoutMs: 10000
  logLevel: info
  resources:
    requests: { cpu: 20m, memory: 64Mi }
    limits: { cpu: 200m, memory: 160Mi }
```

Add `secrets.existing.mcpWoocommerceToken: ""` (key `token`). Extend `values.schema.json` for `global.imageRegistry`/`global.imageTag` (strings).

**`templates/mcp/secrets.yaml`:**
- **The `store-woo-api` copy:** rendered in `namespaces.mcp` when `secrets.existing.storeWooApi` is empty, with data `{{ include "urumi.storeWooApiData" . | nindent 2 }}`.
- **The `mcp-woocommerce-token` Secret:** rendered in `namespaces.mcp` when `secrets.existing.mcpWoocommerceToken` is empty. Its key `token` is `urumi.generatedValue` with canonical namespace `mcp`, length 48. Phase 3 renders a copy into `gateway` with the same canonical namespace.
- **Both** get `helm.sh/resource-policy: keep` and the `urumi.labels` set.
- **`store-secrets.yaml`:** its `store-woo-api` data switches to the same helper.

**`templates/mcp/mcp-woocommerce.yaml`:** a Deployment and a ClusterIP Service. There is **no Ingress**.
- **Pod basics:**
  - Deployment `replicas: 1` and pod labels via `urumi.podLabels` (name `mcp-woocommerce`, component `mcp-server`).
  - Pod security context: uid/gid 1000 via `urumi.podSecurityContext`; `automountServiceAccountToken: false`.
  - Container security context: `urumi.containerSecurityContext` plus `readOnlyRootFilesystem: true`.
- **Container:**
  - Image: `urumi.image` (repository and tag from values).
  - Port `http` 3001.
  - Volumes: an emptyDir mounted at `/tmp`.
- **Env:**
  - `PORT`
  - `WOO_BASE_URL`: `http://wordpress.{{ namespaces.store }}.svc.cluster.local`
  - `WOO_SIGNING_BASE_URL`: from `urumi.storeSigningBaseUrl`
  - `WOO_CONSUMER_KEY` / `WOO_CONSUMER_SECRET`: `secretKeyRef` to the mcp-namespace `store-woo-api` (or the `existing` name)
  - `MCP_AUTH_TOKEN`: from `mcp-woocommerce-token` key `token`
  - `STORE_TIMEZONE`: `.Values.storeSetup.timezone`
  - `WOO_TIMEOUT_MS`, `LOG_LEVEL`
- **Probes:**
  - readinessProbe: `/readyz` every 10s, timeout 3s.
  - livenessProbe: `/healthz` every 20s, timeout 3s, failureThreshold 3.
  - startupProbe: `/healthz`, period 2s, failureThreshold 30.
- **Resources:** from values.
- **Service `mcp-woocommerce`:** port 3001 → target port `http`.
- **Annotation:** add `checksum/secrets: {{ include "urumi.storeWooApiData" . | sha256sum }}` to the pod template, so the pod restarts when the key changes.

**`docker/node-app.Dockerfile`** is one Dockerfile shared by all our Node apps, selected with the build argument `APP`. It has two stages:
1. **build:** `node:24-alpine`.
   1. Copy the root `package.json`, `package-lock.json` and `tsconfig.base.json`, plus `packages/shared/package.json` and `apps/${APP}/package.json`.
   2. Run `npm ci --workspace @urumi/shared --workspace @urumi/${APP}`.
   3. Copy `packages/shared` and `apps/${APP}` sources.
   4. Run `npm run build -w @urumi/shared && npm run build -w @urumi/${APP}`.
   5. Run `npm prune --omit=dev --workspace @urumi/shared --workspace @urumi/${APP}`. If the prune leaves workspace links broken, document the alternative you used.
2. **runtime:** `node:24-alpine`.
   - `ENV NODE_ENV=production`, `WORKDIR /app`.
   - Copy `node_modules`, `packages/shared/{package.json,dist}` and `apps/${APP}/{package.json,dist}` from the build stage.
   - `USER node` (uid 1000), `EXPOSE 3001`.
   - `CMD ["node", "apps/<APP>/dist/main.js"]`. Use a shell-free form: `ENV APP_ENTRY=apps/${APP}/dist/main.js` with `CMD node $APP_ENTRY` is acceptable; prefer an exec form that works with an ARG.

`.dockerignore`: `node_modules`, `**/dist`, `.git`, `.superpowers`, `docs`, `charts`, `deploy`, `scripts`, `*.md`, `.env*`.

**`scripts/build-images.ps1`:**
- It builds every app listed in `$apps = @('mcp-woocommerce')`. Later phases add more apps there.
- Tag: `git rev-parse --short HEAD`, plus `-dirty-<yyyyMMddHHmmss>` when `git status --porcelain` is non-empty. Images are tagged `urumi/<app>:<tag>`.
- It runs `k3d image import urumi/<app>:<tag> -c urumi` for each app.
- It writes `deploy/.images.local.yaml` (git-ignored) containing `global:\n  imageTag: <tag>\n`.
- Every native call is followed by a `$LASTEXITCODE` check, and the script exits 1 with a clear message on failure.
- It prints the tag, and never prints secrets.

**`scripts/deploy.ps1`:** when the values file is `values-local.yaml` and `deploy/.images.local.yaml` exists, add `-f deploy/.images.local.yaml` after it. When that file is missing, print a yellow warning: "no local image tag; run scripts\build-images.ps1 (up.ps1 does this automatically)".

**`scripts/up.ps1`:**
- When it will deploy (fresh install, failed release or `-Redeploy`), it first runs `build-images.ps1`. This must happen before the deploy, because with `--wait` the store setup hook only runs after every workload, including mcp-woocommerce, is Ready.
- The URL block gains this line: `MCP server   : internal only (namespace mcp) — check with scripts\check-mcp-woocommerce.ps1`.

**`scripts/get-secret.ps1 -Namespace <ns> -Name <secret> -Key <key> [-Show]`:** a generic version of the clipboard pattern. It copies the value to the clipboard and prints it only with `-Show`, wraps the clipboard call in try/catch, and has the same messages style as `get-admin-password.ps1`.

**`scripts/dev/mcp-smoke.mjs`:** a Node ESM script using the ADR-007 client.
- Args: `--url http://127.0.0.1:13001/mcp`, and `--write` (optional). The token comes from env `MCP_TOKEN`.
- It connects with a bearer header and lists the tools; there must be exactly 6.
- It calls `ping`, `list_products` (per_page 3) and `list_orders {period:'today'}`, and prints compact summaries (counts, ids). It never prints the token.
- With `--write`, it also:
  - calls `create_product {name: "MCP smoke <ISO time>", regular_price: "1.00", status: "draft"}`. A draft is not shown on the storefront, so demo data stays tidy. Print the id.
  - picks the newest order from `list_orders {per_page:1}`. If there is one, it calls `update_order_status` with that order's **current** status: a no-op change that exercises a signed PUT.
- It exits 0 on success, and 1 with a message on failure.

**`scripts/check-mcp-woocommerce.ps1 [-Write]`:**
1. Check the prerequisites (kubectl, node).
2. Read `mcp-woocommerce-token` into `$env:MCP_TOKEN` without printing it.
3. Start `kubectl -n mcp port-forward svc/mcp-woocommerce 13001:3001` as a hidden process. Wait for the port by polling `Test-NetConnection 127.0.0.1 -Port 13001` (or a TCP connect loop) for up to 15 s. Check `HasExited`.
4. Run `node scripts/dev/mcp-smoke.mjs --url http://127.0.0.1:13001/mcp [--write]`.
5. In a `finally` block, stop the port-forward and remove the env var.
6. Exit with node's exit code, and print a success line.

This check runs entirely through the real in-cluster MCP server. That proves the Service DNS name `wordpress.store.svc.cluster.local`, signed GET/POST/PUT requests and the bearer auth. It supersedes the port-forward-to-WordPress path for routine checks. `check-woo-api.ps1` stays as a low-level diagnostic.

**Steps:**
1. Write the helpers, values, templates, Dockerfile, `.dockerignore` and scripts.
2. Run `helm lint` (local and prod values). Then run `helm template … -f deploy/values-prod.yaml` and confirm:
   - the mcp image is `ghcr.io/…` when `imageRegistry` is set in prod;
   - `WOO_SIGNING_BASE_URL` renders as `http://store.example.com` (no `:443`);
   - with `--set global.publicPort=8081` locally it renders as `http://store.localhost:8081`.

   Add `imageRegistry: ghcr.io/CHANGE-ME` and `imageTag: CHANGE-ME` placeholders, with comments, to `values-prod.yaml`.
3. Run `scripts\up.ps1 -Redeploy`. It builds, imports and deploys. `kubectl -n mcp get pods` shows `mcp-woocommerce` `1/1 Running` with 0 restarts.
4. Run `scripts\check-mcp-woocommerce.ps1`, then `scripts\check-mcp-woocommerce.ps1 -Write`. Both pass. Confirm the created draft product exists via the store REST API, or via the next `list_products` with `status=draft`.
5. Prove the server is not exposed:
   - `kubectl get ingress -A` shows only `store`.
   - `curl.exe -s -o NUL -w "%{http_code}" http://store.localhost/mcp` is NOT our server (it's a WordPress 404).
   - `POST` to the server without a token gives 401. Test this through the port-forward.
6. Run `scripts\get-secret.ps1 -Namespace mcp -Name mcp-woocommerce-token -Key token`. Its output must not contain the token (in-memory True/False check).
7. Run a second `up.ps1 -Redeploy` with no code changes. The image tag stays the same because the tree is clean, but only once you've committed. Verify the pod is not restarted needlessly, or document why it is.
8. **Commits:**

```bash
git add docker .dockerignore scripts/build-images.ps1 .gitignore
git commit -m "build: add shared Node app Dockerfile and image build/import script with unique tags"
git add charts/urumi-platform deploy/values-prod.yaml
git commit -m "feat(helm): deploy the WooCommerce MCP server as an internal-only service"
git add scripts package.json package-lock.json
git commit -m "feat(scripts): build images in up.ps1 and add MCP end-to-end check and secret helper"
```

---

### Task 2.7: Documentation, learning notes and plan bookkeeping

**Files:**
- Create: `docs/learning/02-mcp-protocol.md`, `apps/mcp-woocommerce/README.md`
- Modify: `docs/run-guide.md`, `docs/workflows.md`, `docs/architecture.md`, `docs/troubleshooting.md`, `docs/deployment.md`, `docs/README.md`, `docs/diagrams/README.md`, `README.md`, `docs/decisions/ADR-005-*.md`, `docs/superpowers/specs/2026-10-18-mcp-gateway-design.md` (§5.2, §4 if needed), the master plan (tick the Phase 2 carry-forward items with "→ Task 2.x"; update the Task 2.x interface notes where this plan changed them)

**Content:**

**`docs/run-guide.md`:** a new section "WooCommerce MCP server (Phase 2)". It covers:
- what it is, and why it is internal-only;
- how it starts (`up.ps1` builds and deploys it automatically);
- health (`kubectl -n mcp get pods`, logs `kubectl -n mcp logs deploy/mcp-woocommerce`);
- the end-to-end check (`check-mcp-woocommerce.ps1`, plus `-Write`, and what it creates);
- how to explore it with **MCP Inspector**: port-forward, copy the token with `get-secret.ps1`, then the Inspector UI or CLI command from ADR-007, with the header `Authorization: Bearer <paste>`;
- the tools table;
- what is not possible yet: external clients connect through the gateway in Phase 3.

Also:
- Update the "each part" table so the MCP server row is Available.
- Add `build-images.ps1` to daily use, and explain image tags.

**`docs/workflows.md`:** a new workflow "MCP tool call to the store".
- A Mermaid sequence: client → MCP server (bearer check, zod validation) → WooCommerce REST (OAuth1 signed with the public URL, sent to the Service DNS name) → MariaDB, and back.
- Explain it in text.
- A failure table: bad token, invalid input, WooCommerce 4xx/5xx, timeout, network, a 301 redirect, an empty store, clock skew > 15 min.
- State that there are no retries, and why.

**`docs/learning/02-mcp-protocol.md`:** written for the interview. Cover:
- what MCP is;
- JSON-RPC 2.0;
- the 2026-07-28 stateless Streamable HTTP flow as actually used here (per ADR-007);
- the lifecycle/discovery → `tools/list` → `tools/call`;
- **real request/response JSON captured from our server**, from the Inspector CLI or `mcp-smoke.mjs` with a debug flag, with secrets redacted;
- `structuredContent` vs `content`, and `isError` vs protocol errors;
- where auth happens.

**`apps/mcp-woocommerce/README.md`:** env vars, how to run locally, tests, the tools, OAuth1 notes (signing base URL, pretty permalinks required, only scalar query keys, the ±15 min timestamp window, no retries).

**ADR-005:**
- the key owner is now the `urumi-mcp` shop manager (least privilege);
- the upsert is atomic;
- Service-DNS access and signed POST/PUT are **verified** in Phase 2;
- `WOO_SIGNING_BASE_URL` comes from the chart helper.

**`architecture.md`, `docs/README.md`, `diagrams/README.md`, `troubleshooting.md`:**
- the MCP server is built;
- new diagrams are indexed;
- troubleshooting entries: image not found or `ErrImageNeverPull` (run `build-images.ps1`); mcp-woocommerce CrashLoop on an env validation message; 401 from the MCP server; WooCommerce 401 invalid signature (signing base URL); a timeout; the port-forward port being busy.

**`README.md`:** a features list and quick-start note for the MCP server, linking the run guide.

**Rules:**
- The relative-link check passes (0 broken).
- Every claim is verified or labelled.
- No secrets anywhere.

**Commits:**

```bash
git add docs/learning/02-mcp-protocol.md apps/mcp-woocommerce/README.md
git commit -m "docs: explain the MCP protocol flow with captured requests and document the MCP server"
git add docs README.md
git commit -m "docs: add MCP server to run guide, workflows and troubleshooting; record Phase 2 decisions"
```

## Phase 2 exit check (the user runs it)

1. `powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`. The URL block shows the MCP line.
2. `kubectl -n mcp get pods,svc` shows `mcp-woocommerce` running, and the Service type is ClusterIP. `kubectl get ingress -A` lists only `store`.
3. `powershell -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1` reports 6 tools and lists products and today's orders.
4. **Optional:**
   1. Copy the token with `scripts\get-secret.ps1 -Namespace mcp -Name mcp-woocommerce-token -Key token`.
   2. Port-forward the server.
   3. Open MCP Inspector, connect with the bearer header, and call `create_product {"name":"Demo Mug","regular_price":"12.50"}`.
   4. Open `http://store.localhost/shop/`. The product is there.
5. `npm test` passes, as do `npm run typecheck` and `npm run lint`.

## Carry-forward mapping (master plan → this plan)

| Phase 2 carry-forward item | Resolved in |
|---|---|
| `WooClient` signingBaseUrl vs baseUrl | 2.3 |
| `registerWooTools` takes an interface | 2.4 (`ToolDeps.woo: WooApi`) |
| `/readyz` independent of the setup Job | 2.4 (`main.ts`), Global Constraints |
| ESLint + per-workspace tsconfig | 2.2 |
| Mutable image tags | 2.6 (git-SHA tags + `.images.local.yaml`) |
| Port the OAuth1 signer + KAT | 2.3 |
| Signer limits; Map params; reject `oauth_*` | 2.3 |
| signingBaseUrl derivation + chart helper | 2.6 (`urumi.storeSigningBaseUrl`); 2.6 `check-woo-api.ps1` derivation |
| ±15 min window, no nonce reuse | 2.3 (fresh nonce per request; no retries) |
| `store-woo-api` copy in `mcp` via one helper | 2.6 (`urumi.storeWooApiData`) |
| Service DNS + POST/PUT signing verified | 2.6 (`check-mcp-woocommerce.ps1 -Write`) |
| Image helper + registry/tag | 2.6 |
| Least-privilege key owner | 2.5 |
| Atomic key upsert | 2.5 |
| `urumi.podLabels` | 2.5 |
| `_helpers.tpl` `toYaml .Values` comment | 2.5 |
| Deploy ordering (images before deploy) | 2.6 (`up.ps1` builds first) |
| Pretty permalinks note | 2.7 (MCP server README) |
| Supersede the check script's port-forward | 2.6 (`check-mcp-woocommerce.ps1`) |

## Self-review
- **Spec coverage:**
  - §5.2: tools (2.4), REST + OAuth1 (2.3), the bearer upstream credential (2.6), errors (2.3/2.4).
  - §4: SDK gate (2.1).
  - §8.5: probes, resources, non-root, read-only FS (2.6).
  - "Not reachable from outside the cluster": no Ingress, verified in 2.6.
- **Interface consistency:**
  - `WooApi`, `ToolDeps`, `ToolDefinition`, `startMcpHttpServer` and `UpstreamAuth` are used identically in 2.2–2.6.
  - The Secret keys `consumer-key`, `consumer-secret` and `token` match across templates and scripts.
  - The port is 3001 everywhere, with port-forward 13001.
- **SDK-dependent code** (the `mcpHttpServer` internals, the `registerWooTools` adapter, the test clients, `mcp-smoke.mjs`) is specified by behavior plus the ADR-007 cheat sheet. Everything else has complete code above.
