# Phase 3 — Gateway Core + Upstreams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team MCP gateway on Kubernetes. Members authenticate with personal, hashed, revocable API keys. One `/mcp` endpoint at `http://app.localhost/mcp` aggregates the tools of three in-cluster upstreams (WooCommerce, Notes, Utilities) under collision-safe prefixes. A slow or dead upstream never breaks the others, and every tool call is audited in Postgres.

**Architecture:**
- **Two new upstreams.** `apps/mcp-notes` (bearer token) and `apps/mcp-utilities` (custom header) reuse `packages/shared`, the same way `mcp-woocommerce` does.
- **The gateway (`apps/gateway`) is Express plus SDK v2, and is both an MCP client and an MCP server:**
  - It is an MCP client to every upstream. A health loop every 15 s keeps a cached tool catalog.
  - It is an MCP server on `/mcp`. Raw `tools/list` and `tools/call` handlers sit on `McpServer.server` (ADR-007).
  - It serves a JSON `/api` for sessions, invites, users, keys, servers and audit.
  - It stores users, hashed keys, AES-GCM-encrypted upstream credentials and audit rows in Postgres via Drizzle.
- **Deployment:** one Helm chart adds Postgres, the gateway, the two upstreams and the `app.localhost` Ingress.

**Tech Stack:** Node 24, TypeScript 6.0.3, Express 5.3.0, MCP SDK v2 (`@modelcontextprotocol/server`/`client` 2.3.1), zod 4.6.7, Drizzle ORM 0.45.3 + drizzle-kit 0.31.11, `pg` 8.23.1 (PGlite 0.5.8 in tests), `@node-rs/argon2` 2.2.1, `jose` 6.2.12, pino 10.4.0, Vitest 5.0.5, supertest 7.3.1, Helm 4, Postgres 17.11.

**Spec:** [`docs/superpowers/specs/2026-10-18-mcp-gateway-design.md`](../specs/2026-10-18-mcp-gateway-design.md) (§4, §5.3, §6.1–6.8, §8, §9, §10). The master plan is [`2026-10-18-mcp-gateway-implementation-plan.md`](2026-10-18-mcp-gateway-implementation-plan.md): Phase 3 tasks and the Phase 3 carry-forward list. ADRs 006, 007, 008, 009, 010, 013 and 014.

**Pre-flight spike (done while writing this plan, 2026-10-19; scratch only, not committed):**
- **Drizzle.** drizzle-orm 0.45.3 + drizzle-kit 0.31.11 generated a migration. The PGlite migrator applied it. One shared type `PgDatabase<PgQueryResultHKT, typeof schema>` accepted both the PGlite and the node-postgres instance (`tsc` strict passed). `ON DELETE SET NULL` worked. **PGlite returns `bytea` as `Uint8Array`, not `Buffer`**, so the custom column type must convert in `fromDriver`.
- **argon2.** `@node-rs/argon2` 2.2.1 hashed and verified on Windows (Node 24.0.1) and inside `node:24-alpine` (Node 24.22.0, prebuilt musl binary, no compiler).
- **jose.** `jose` 6.2.12 signed and verified an HS256 JWT with an audience.

## Global Constraints

- **Git:**
  - Branch `phase-3-gateway`, already created from `main`, which contains Phase 2.
  - Commit after every task, often several times per task, with conventional prefixes.
  - **Never push.**
  - **No `Co-Authored-By` or Claude/AI attribution.**
- **Root path:** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes`. It contains spaces, so quote it.
- **Line endings:** LF, except `*.ps1` (CRLF).
- **TypeScript:**
  - `strict`, `noUncheckedIndexedAccess`, ESM `NodeNext` with `.js` extensions in relative imports.
  - No `any` without `// eslint-disable-next-line` and a reason.
  - TypeScript 6 needs an explicit `rootDir` in build tsconfigs.
- **Pinned versions** (exact, installed with `npm install -E`):
  - Runtime: drizzle-orm `0.45.3`, pg `8.23.1`, @node-rs/argon2 `2.2.1`, jose `6.2.12`.
  - Dev: drizzle-kit `0.31.11`, @types/pg `8.23.1`, @electric-sql/pglite `0.5.8`, supertest `7.3.1`, @types/supertest `7.2.1`.
  - Existing pins stay unchanged (zod 4.6.7, express 5.3.0, pino 10.4.0, MCP packages per ADR-007).
  - Image: `postgres:17.11-bookworm`.
- **No secrets in output:**
  - Never print or log API keys, session or invite tokens, passwords, upstream credentials, `GATEWAY_ENCRYPTION_KEY`, `GATEWAY_INTERNAL_TOKEN_SECRET` or the Postgres password. That covers logs, errors, API responses (except the one-time key plaintext and invite link), test output and script output.
  - Scripts print the command that fetches a secret, never the secret, except with `-Show`.
- **Names (spec §6.4, ADR-006):**
  - Slug `^[a-z][a-z0-9-]{1,15}$`, unique, immutable.
  - Separator `__`, split on the **first** `__`.
  - Gateway tool name `^[a-zA-Z0-9_-]{1,64}$`.
  - Description prefix `[<Server name>] `.
- **Timeouts (spec §6.3, §6.5):**
  - Health check every 15000 ms with a 5000 ms timeout.
  - Tool call 20000 ms (`UPSTREAM_CALL_TIMEOUT_MS`). It must stay greater than `WOO_TIMEOUT_MS` (10000).
  - **Tool calls are never retried.**
- **API keys (ADR-008):**
  - `ugw_` + 32 random bytes in base62, left-padded to 43 characters (`^ugw_[0-9A-Za-z]{43}$`).
  - Stored as SHA-256 hex; display prefix = the first 12 characters.
  - No auth cache.
- **Passwords:** argon2id, length 10–200. **Emails** are trimmed and lowercased everywhere.
- **Sessions:**
  - Cookie `ugw_session`: 32 random bytes base64url, only the SHA-256 is stored.
  - Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`, plus `Secure` when `COOKIE_SECURE=true`.
  - **CSRF:** every mutating `/api` request (POST/PUT/PATCH/DELETE) needs `Content-Type: application/json` **and** `Origin` equal to the origin of `PUBLIC_APP_URL`.
- **Invites:** 32 random bytes base64url, SHA-256 stored, link `${PUBLIC_APP_URL}/invite/<token>`, valid 72 h, single use.
- **Internal chat token (ADR-010):** HS256 JWT, `sub` = user id, `aud` = `gateway-chat`, `iss` = `urumi-gateway`, expiry 300 s. Verify with `algorithms: ['HS256']` and a 5 s clock tolerance.
- **Ports:** gateway 3000, mcp-woocommerce 3001, mcp-notes 3002, mcp-utilities 3003, Postgres 5432; local port-forward for Postgres 15432.
- **API error shape (spec §6.2):** `{"error":{"code":"…","message":"…","details":{…}?,"requestId":"…"}}`. Codes and statuses:
  - `VALIDATION_FAILED` 400, `SSRF_REJECTED` 400
  - `UNAUTHENTICATED` 401, `INVALID_CREDENTIALS` 401
  - `FORBIDDEN` 403, `CSRF_REJECTED` 403
  - `NOT_FOUND` 404, `INVITE_INVALID` 404
  - `CONFLICT` 409, `RATE_LIMITED` 429 (with `Retry-After`)
  - `INTERNAL` 500
- **Kubernetes workloads (spec §8.5, §8.7):**
  - Probes, requests and limits on every container.
  - Pod: `runAsNonRoot` with explicit uid/gid/fsGroup, seccomp `RuntimeDefault`, `automountServiceAccountToken: false`.
  - Container: `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`.
  - Node apps run as uid 1000 with `readOnlyRootFilesystem: true` and a `/tmp` emptyDir. Postgres runs as uid/gid 999.
  - Resources: gateway 50m/128Mi → 500m/384Mi; Postgres 50m/128Mi → 500m/256Mi; each MCP server 20m/64Mi → 200m/160Mi.
- **Generated Secrets:** use `urumi.generatedValue` with one canonical namespace per secret, and annotate them `helm.sh/resource-policy: keep`. Never `toYaml .Values`.
- **Docs:** state only what was verified and label the rest "expected" or "not tested". `docs/run-guide.md` gets a gateway section, including how to see the Postgres data. No unbuilt feature is described as available (the dashboard and chat are Phase 4).
- **Verification commands:**
  - `npm test`, `npm run typecheck`, `npm run lint`
  - `helm lint charts/urumi-platform -f deploy/values-local.yaml` (and `-f deploy/values-prod.yaml`)
  - Scripts run as `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\<x>.ps1`.

## Review Focus

These five inputs are the most likely to hurt a user and are not obvious from the spec; each is pinned by a test in the task named.

1. **An upstream advertises a tool whose prefixed name breaks `^[a-zA-Z0-9_-]{1,64}$`** (too long, a dot, a space). That tool alone is skipped and listed in `skippedTools`; the server's other tools are still served. Test in Task 3.5.
2. **An upstream pod restarts** (connection refused, then back on the same address). The next health check must build a **fresh** client and return to `connected`, with tools restored within one interval, never stuck `unreachable` with a stale client. Test in Task 3.5.
3. **An upstream answers with a redirect** (e.g. 302 to `http://169.254.169.254/`). It is never followed; the server becomes `unreachable` with `HTTP 302 from upstream (redirects are not followed)`. Test in Task 3.5.
4. **Email case and whitespace:** `" Admin@Example.COM "` logs in as `admin@example.com`; an invite for an existing user's email in different case is a `CONFLICT`. Test in Task 3.6.
5. **The gateway starts before Postgres is ready.** `/readyz` is 503 until the DB answers. Startup retries connect+migrate (30 attempts, 2 s apart) before exiting non-zero, and never serves `/mcp` with an unmigrated DB. Test in Task 3.3.

---

## File structure (decisions locked here)

```
packages/shared/src/
  mcpHttpServer.ts      MODIFY: auth hook, buildServer, extraRoutes, logPath, request id, mcpRequestLocals
  tools.ts              CREATE: ToolResult, ToolDefinition<D,S>, defineTool, registerTools, ok(), toolError()
  period.ts             CREATE (moved from apps/mcp-woocommerce/src/woo/period.ts)
apps/mcp-woocommerce/src/tools/{types,format,index,listOrders}.ts   MODIFY: use shared tools/period
apps/mcp-notes/         CREATE: src/{config,notesStore,tools,server,main}.ts, test/*, package.json, tsconfigs, vitest.config.ts, README.md
apps/mcp-utilities/     CREATE: src/{config,calc,tools,server,main}.ts, test/*, same scaffolding, README.md
apps/gateway/
  package.json tsconfig.json tsconfig.build.json vitest.config.ts drizzle.config.ts README.md
  drizzle/              generated SQL migrations (committed)
  src/main.ts           process entry: config, DB connect+migrate with retry, bootstrap, seed, manager, listen
  src/config.ts         env schema (zod) → Config
  src/server.ts         startGateway(deps, listen): wires shared server + /api + /mcp
  src/db/{schema,client,migrate}.ts
  src/api/{errors,validate,router}.ts       error shape, zod body/query helpers, mounts all /api routers
  src/api/{auth,invites,users,keys,servers,audit}.routes.ts
  src/security/{crypto,passwords,ssrf}.ts
  src/auth/{users,sessions,apiKeys,invites,internalToken,bearer,middleware,bootstrap,rateLimit}.ts
  src/upstreams/{naming,errors,connection,repository,manager,seed}.ts
  src/audit/{writer,query}.ts
  src/mcp/{endpoint,auth}.ts               gateway McpServer factory + /mcp auth RequestHandler
  test/helpers/{testDb,fakeUpstream,harness}.ts
  test/**/*.test.ts
docker/node-app.Dockerfile                  MODIFY: copy apps/<APP>/drizzle (may be empty)
charts/urumi-platform/
  templates/_helpers.tpl                    MODIFY: generatedValue "random: bytes" mode; urumi.simpleMcpServer
  templates/mcp/{mcp-notes,mcp-utilities}.yaml, secrets.yaml (MODIFY)
  templates/gateway/{postgres,gateway,secrets,configmap,ingress}.yaml
  values.yaml values.schema.json            MODIFY
deploy/values-prod.yaml                     MODIFY: secrets.existing for the new Secrets
scripts/{build-images,up}.ps1               MODIFY; scripts/check-gateway.ps1 CREATE; scripts/dev/gateway-smoke.mjs CREATE
docs/…                                      Task 3.9
```

---

### Task 3.1: Extend `packages/shared` (auth hook, custom server, extra routes, request id) and share tool helpers

Resolves carry-forwards: "Extend `startMcpHttpServer`, do not fork it", "Tests for malformed JSON and the 413 body limit", and the request-id / invite-path-redaction parts of "HTTP edge cases".

**Files:**
- Modify: `packages/shared/src/mcpHttpServer.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/tools.ts`, `packages/shared/src/period.ts` (moved verbatim from `apps/mcp-woocommerce/src/woo/period.ts`)
- Move: `apps/mcp-woocommerce/test/period.test.ts` → `packages/shared/test/period.test.ts`, with imports adjusted
- Modify: `apps/mcp-woocommerce/src/tools/{types,format,index,listOrders}.ts`, so they consume the shared helpers. All existing woo tests must pass unchanged, except for import paths.
- Test: `packages/shared/test/mcpHttpServer.test.ts` (extend), `packages/shared/test/tools.test.ts`

**Interfaces:**
- Consumes: the existing `UpstreamAuth`, `upstreamAuthMiddleware`, `normalizeHosts`, `Logger`.
- Produces:
```ts
// mcpHttpServer.ts
export const mcpRequestLocals: AsyncLocalStorage<Record<string, unknown>>; // store = res.locals of the /mcp request
export interface McpHttpServerOptions {
  name: string; version: string; port: number; host?: string; logger: Logger; allowedHosts: string[];
  auth: UpstreamAuth | RequestHandler;          // a function is used as-is (gateway); an object goes through upstreamAuthMiddleware
  registerTools?: (server: McpServer) => void;  // exactly one of registerTools / buildServer (else throw at start)
  buildServer?: () => McpServer;                // gateway: custom handlers on mcp.server
  extraRoutes?: (app: express.Express) => void; // mounted after the probes, before /mcp
  logPath?: (path: string) => string;           // sanitises the path written in the request log line
  readinessCheck?: () => Promise<boolean>;
}
// tools.ts
export interface ToolResult { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
export interface ToolDefinition<D, S extends z.ZodObject = z.ZodObject> { name: string; title: string; description: string; inputSchema: S; handler: (args: z.infer<S>, deps: D) => Promise<ToolResult> }
export function defineTool<D, S extends z.ZodObject>(def: ToolDefinition<D, S>): ToolDefinition<D>;
export function registerTools<D>(server: McpServer, tools: readonly ToolDefinition<D>[], deps: D): void;
export function ok(summary: string, data: Record<string, unknown>): ToolResult;  // compact JSON, exactly as woo's ok() today
export function toolError(text: string): ToolResult;                              // { content:[{type:'text',text}], isError:true }
// period.ts: resolvePeriod, Period, PERIODS (unchanged signatures)
```
- Woo keeps its local names as thin re-exports: `ToolDefinition<S> = shared ToolDefinition<ToolDeps, S>`, `defineTool`, `ok` and `registerWooTools`, so the woo tool files keep importing from `./types.js`/`./format.js`.

**Behaviour fixed here:**
- **Request id.** Every request gets `res.locals.requestId`. Use the incoming `X-Request-Id` when it matches `^[A-Za-z0-9._-]{8,64}$`, otherwise `randomUUID()`. It is echoed in the `X-Request-Id` response header and written as `requestId` in the request log line.
- **`/mcp` order is unchanged:** host check → auth → `express.json({limit:'1mb'})` → handler.
- **Handler context.** The handler runs inside `mcpRequestLocals.run(res.locals, …)`, so tool handlers can read what auth put on `res.locals`.

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/mcpHttpServer.test.ts`:
  - `custom auth function: res.locals reach the tool handler`: auth `(req,res,next)=>{res.locals.user='u1';next()}`, plus a `buildServer` that registers tool `who` returning `ok('who', { user: mcpRequestLocals.getStore()?.user })`. An SDK client calling `who` gets `structuredContent.user === 'u1'`.
  - `custom auth function can reject`: auth responds 401 `{jsonrpc:'2.0',error:{code:-32001,message:'Unauthorized'},id:null}`. The client's connect fails, and the tool handler call count stays 0.
  - `extraRoutes are served and not host-checked`: `extraRoutes: app => app.get('/api/hello', (_q,r)=>r.json({hi:true}))`. `GET /api/hello` with `Host: evil.example` → 200 `{hi:true}`.
  - `malformed JSON on /mcp → 400 -32700`: body `{"jsonrpc":` with the correct auth → status 400, body `error.code === -32700`, message `Invalid request body`.
  - `body over 1mb → 413 -32700`: a 1.1 MB JSON string → status 413, `error.code === -32700`.
  - `X-Request-Id echoed when valid, replaced when not`: `abcd-1234-efgh` is echoed. `<script>` is replaced by a value matching the UUID regex.
  - `logPath sanitises the logged path`: `logPath: p => p.replace(/^\/api\/invites\/[^/]+/, '/api/invites/:token')`, `GET /api/invites/SECRET123` → the captured log line has `path: '/api/invites/:token'` and does not contain `SECRET123`. Capture the log with a `pino` destination stream, as `logger.test.ts` does.
  - `exactly one of registerTools / buildServer`: both, or neither → `startMcpHttpServer` rejects with `Error('exactly one of registerTools or buildServer is required')`.
- [ ] **Step 2: Write `packages/shared/test/tools.test.ts`:**
  - `ok()` gives text `summary + '\n' + compact JSON` and the same `structuredContent`.
  - `toolError('x')` → `isError: true`.
  - `registerTools` registers each definition; an SDK client lists them, and invalid args come back as an `isError` result.
- [ ] **Step 3: Run the tests and confirm they fail.** Run `npm run test -w @urumi/shared`. Expected: the new tests FAIL (missing exports or behaviour).
- [ ] **Step 4: Implement**, following the interfaces above.
  - Move `period.ts` and its test.
  - Switch the woo files to the shared helpers.
  - Export everything from `index.ts`.
- [ ] **Step 5: Run the full suite, typecheck and lint.** Run `npm test; npm run typecheck; npm run lint`. Expected: everything passes (shared, plus all 77 woo tests).
- [ ] **Step 6: Commit.**
```bash
git add packages/shared apps/mcp-woocommerce
git commit -m "feat(shared): add auth hook, custom server factory, extra routes and request ids to the MCP HTTP server"
git commit -m "refactor(shared): share tool definition helpers and period resolution across MCP servers"   # split if practical
```

---

### Task 3.2: Notes and Utilities MCP servers (apps, no Helm yet)

**Files:**
- Create `apps/mcp-notes/` with:
  - `package.json`: name `@urumi/mcp-notes`, the same scripts and dependencies as `@urumi/mcp-woocommerce`;
  - `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` (the same `@urumi/shared` alias);
  - `src/{config,notesStore,tools,server,main}.ts`, `README.md`;
  - `test/{notesStore,server}.test.ts`.
- Create `apps/mcp-utilities/` with the same scaffolding (name `@urumi/mcp-utilities`), `src/{config,calc,tools,server,main}.ts`, `README.md` and `test/{calc,server}.test.ts`.

**Interfaces:**
- Consumes (Task 3.1): `startMcpHttpServer`, `defineTool`, `registerTools`, `ok`, `toolError`, `resolvePeriod`, `PERIODS`, `loadEnv`, `createLogger`.
- Produces:
```ts
// notes
export interface Note { id: number; title: string; content: string; createdAt: string }  // id 1,2,3…; createdAt ISO
export class NotesStore { constructor(o?: { maxNotes?: number; now?: () => Date });   // maxNotes default 500
  create(title: string, content: string): Note;   // throws NotesFullError when full
  list(limit: number): Note[];                    // newest first
  search(query: string, limit: number): Note[];   // case-insensitive substring of title OR content, newest first
  delete(id: number): boolean }
export class NotesFullError extends Error {}
export function startNotesServer(o: { config: NotesConfig; logger: Logger; version: string; store?: NotesStore; now?: () => Date; host?: string }): Promise<RunningMcpHttpServer>;
// utilities
export class CalcError extends Error {}
export function evaluate(expr: string): number;
export function startUtilitiesServer(o: { config: UtilitiesConfig; logger: Logger; version: string; now?: () => Date; host?: string }): Promise<RunningMcpHttpServer>;
```

**Config:**
- **Both servers:** `PORT` (notes default 3002, utilities default 3003), `LOG_LEVEL`, and `MCP_ALLOWED_HOSTS`. Validate them as in woo's `config.ts`.
- **Notes:** `MCP_AUTH_TOKEN` (min 16); auth `{kind:'bearer'}`.
- **Utilities:** `UTILITIES_KEY` (min 16); auth `{kind:'header', header:'x-utilities-key', value}`. Also `DEFAULT_TIMEZONE`, default `UTC`, a valid IANA zone.

**Tools.** Descriptions are verbatim, and inputs are zod with explicit bounds, so no huge numbers reach the JSON Schema.

| Server | Tool | Description | Input | Result `structuredContent` |
|---|---|---|---|---|
| notes | `create_note` | `Save a note with a title and text. Returns the new note.` | `title` 1–200, `content` 1–2000 | `{ note }`; when full → `toolError('Note limit reached (500); delete some notes first.')` |
| notes | `list_notes` | `List saved notes, newest first.` | `limit` 1–50, default 20 | `{ notes, count }` |
| notes | `search_notes` | `Find notes whose title or text contains the query (case-insensitive).` | `query` 1–100, `limit` 1–50, default 20 | `{ notes, count }` |
| notes | `delete_note` | `Delete a note by id.` | `id` int 1–2147483647 | `{ deleted: true, id }`; missing → `toolError('Note <id> not found.')` |
| notes | `ping` | `Health check: returns ok and the server time.` | — | `{ ok: true, server: 'mcp-notes', time }` |
| utilities | `date_range` | `Start and end (UTC ISO) of today, yesterday or the last 7 days in a time zone (default: the store's).` | `preset` enum `PERIODS`; `timezone?` 1–64 | `{ preset, timezone, after, before }`; bad zone → `toolError('Unknown time zone: <tz>')` |
| utilities | `current_time` | `Current time in UTC and in a time zone (default: the store's).` | `timezone?` | `{ utc, timezone, local: 'YYYY-MM-DD HH:mm:ss', offset: '+05:30' }` |
| utilities | `calculate` | `Evaluate arithmetic: + - * / % ^ and parentheses, decimals allowed.` | `expression` 1–200 | `{ expression, result }`; CalcError → `toolError('Cannot evaluate: <reason>')` |
| utilities | `ping` | `Health check: returns ok and the server time.` | — | `{ ok: true, server: 'mcp-utilities', time }` |

**Calculator grammar.** It is recursive descent; there is no `eval`, `Function` or `vm`.
```
expr   := term (('+'|'-') term)*
term   := unary (('*'|'/'|'%') unary)*
unary  := '-' unary | power
power  := atom ('^' unary)?          // right-associative; -2^2 = -4, 2^-1 = 0.5
atom   := number | '(' expr ')'      // number := digits ('.' digits)?  (whitespace ignored)
```
- **Errors** (`CalcError` reasons): `division by zero` (for `/` and `%`), `unexpected character 'x' at position n`, `unexpected end of expression`, `result is not a finite number`, and `too deeply nested` (parenthesis depth over 50).
- **Result:** `Number(result.toPrecision(12))`.

- [ ] **Step 1: Write the failing tests.**
  - **`calc.test.ts`:**
    - These expressions evaluate as listed: `2+3*4`=14, `(2+3)*4`=20, `2^3^2`=512, `-2^2`=-4, `2^-1`=0.5, `10%4`=2, `7/2`=3.5, ` 1.5 * 2 `=3, `0.1+0.2`=0.3, `--3`=3.
    - These throw `CalcError`:
      - `1/0` → `division by zero`
      - `5%0` → `division by zero`
      - `process.exit()` → `unexpected character 'p' at position 0`
      - `2+` → `unexpected end of expression`
      - `(1` → `unexpected end of expression`
      - `10^400` → `result is not a finite number`
      - 51 nested parentheses → `too deeply nested`
  - **`notesStore.test.ts`:**
    - Ids are 1, 2, 3.
    - `list` is newest first and respects `limit`.
    - `search('ORDERS')` matches a title `Daily orders` and content `…orders…`.
    - `delete` returns true, then false.
    - `maxNotes: 2` → the third `create` throws `NotesFullError`.
  - **`notes/server.test.ts`** (a real SDK client over HTTP, like woo's `server.test.ts`):
    - It lists exactly the 5 tool names.
    - `create_note` → `list_notes` shows it.
    - `delete_note {id: 99}` → `isError` `Note 99 not found.`
    - No token → connect fails (401).
  - **`utilities/server.test.ts`:**
    - It lists exactly the 4 tool names.
    - `date_range {preset:'today', timezone:'Asia/Kolkata'}` with `now = 2026-10-18T20:00:00Z` → `after = 2026-10-18T18:30:00.000Z`, `before = 2026-10-19T18:30:00.000Z`.
    - Omitting `timezone` uses `DEFAULT_TIMEZONE`.
    - `timezone:'Mars/Base'` → `isError` `Unknown time zone: Mars/Base`.
    - `current_time {timezone:'Asia/Kolkata'}` at that same `now` → `local = '2026-10-19 01:30:00'`, `offset = '+05:30'`.
    - `calculate {expression:'2+3*4'}` → `result: 14`.
    - The wrong `x-utilities-key` → connect fails (401).
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test -w @urumi/mcp-notes; npm test -w @urumi/mcp-utilities`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the config, store, calculator, tools, `server.ts` and `main.ts`. `main.ts` mirrors woo's: env errors exit 1 with names only, a startup log without secrets, and SIGTERM/SIGINT shut down cleanly. Write each app's `README.md` with its env vars, tools, auth and limits. State the in-memory limitation: a restart clears the notes.
- [ ] **Step 4: Run all checks.** Run `npm test; npm run typecheck; npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit.**
```bash
git add apps/mcp-notes package.json package-lock.json
git commit -m "feat(notes-mcp): add bearer-protected notes MCP server"
git add apps/mcp-utilities package-lock.json
git commit -m "feat(utilities-mcp): add header-protected utilities MCP server with a safe calculator"
```

---

### Task 3.3: Gateway scaffold: config, Drizzle schema, migrations, DB handle, probes, error shape

Resolves these carry-forwards:
- **`type Db` union.** Uses `PgDatabase<PgQueryResultHKT, typeof schema>`, and tests run on PGlite (spec §11 is updated in Task 3.9).
- **The encryption-key length check.**
- **`audit_logs.server_id ON DELETE SET NULL`.**
- **`AppDeps.llm`.** Phase 3 has no LLM dependency at all; Phase 4 adds one (ruling: YAGNI).

**Files:**
- Create in `apps/gateway`:
  - the package files: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `drizzle.config.ts`;
  - `src/config.ts`, `src/db/{schema,client,migrate}.ts`, `src/api/{errors,validate,router}.ts`, `src/server.ts`, `src/main.ts`;
  - `drizzle/` (generated);
  - `test/helpers/testDb.ts`, `test/scaffold.test.ts`, `test/config.test.ts`.
- `package.json` details:
  - `@urumi/gateway` depends on `@urumi/shared`, `@modelcontextprotocol/server`, `@modelcontextprotocol/client` (both 2.3.1), `express`, `zod`, and the runtime pins above.
  - devDependencies are the dev pins above plus `@types/express` 5.0.6.
  - Script `build`: `tsc -p tsconfig.build.json`. Script `db:generate`: `drizzle-kit generate`.

**Interfaces:**
- Produces:
```ts
// config.ts — every name below is an env var; errors name variables only
export interface Config {
  PORT: number;                       // 3000
  LOG_LEVEL: string;                  // info
  PUBLIC_APP_URL: string;             // url, e.g. http://app.localhost (invite links + CSRF origin)
  COOKIE_SECURE: boolean;             // "true"/"false", default false
  MCP_ALLOWED_HOSTS: string[];        // default localhost,127.0.0.1 (comma list, empties dropped)
  GATEWAY_ENCRYPTION_KEY: Buffer;     // base64 that MUST decode to exactly 32 bytes
  GATEWAY_INTERNAL_TOKEN_SECRET: string; // min 32 chars
  BOOTSTRAP_ADMIN_EMAIL: string;      // email, lowercased
  BOOTSTRAP_ADMIN_PASSWORD: string;   // 10..200
  SEED_SERVERS: SeedServer[];         // JSON, default "[]"
  SSRF_ALLOWED_INTERNAL_HOSTS: string[]; // default "*.mcp.svc.cluster.local"
  SSRF_ALLOW_LOOPBACK: boolean;       // default false; tests/dev only, never set by Helm
  UPSTREAM_HEALTH_INTERVAL_MS: number;   // 15000 (1000..300000)
  UPSTREAM_HEALTH_TIMEOUT_MS: number;    // 5000 (500..60000)
  UPSTREAM_CALL_TIMEOUT_MS: number;      // 20000 (1000..120000)
  // Postgres: read by `pg` from PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (all required in loadConfig, PGPORT default 5432)
}
export interface SeedServer { slug: string; name: string; url: string; authType: 'none' | 'bearer' | 'header'; authHeaderName?: string; credentialEnv?: string }
export function loadConfig(env?: NodeJS.ProcessEnv): Config;

// db
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface DbHandle { db: Db; ping(): Promise<boolean>; migrate(): Promise<void>; close(): Promise<void> }
export function createPostgresHandle(): DbHandle;               // pg.Pool from PG* env, max 10
export function connectWithRetry(open: () => Promise<DbHandle>, o: { attempts: number; delayMs: number; logger: Logger; sleep?: (ms: number) => Promise<void> }): Promise<DbHandle>;  // open + ping + migrate per attempt
// test/helpers/testDb.ts
export function createTestDb(): Promise<DbHandle>;              // fresh PGlite, migrated

// api/errors.ts
export class ApiError extends Error { constructor(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) }
export type ApiErrorCode = 'VALIDATION_FAILED' | 'SSRF_REJECTED' | 'UNAUTHENTICATED' | 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'CSRF_REJECTED' | 'NOT_FOUND' | 'INVITE_INVALID' | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL';
export function apiErrorHandler(logger: Logger): ErrorRequestHandler;  // ApiError → its status; zod → 400 VALIDATION_FAILED with details.issues; else 500 INTERNAL (logged, no stack in response)
// api/validate.ts
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S>;   // throws ApiError VALIDATION_FAILED
export function parseQuery<S extends z.ZodType>(schema: S, query: unknown): z.infer<S>;
// api/router.ts
export function createApiRouter(deps: GatewayDeps): express.Router; // json(100kb) + routers + 404 NOT_FOUND + apiErrorHandler
// server.ts
export interface GatewayDeps { config: Config; logger: Logger; db: DbHandle; clock: () => Date }  // later tasks ADD fields
export function startGateway(deps: GatewayDeps, listen: { port: number; host?: string }): Promise<RunningMcpHttpServer>;
```

**Schema** (`src/db/schema.ts`). The tables and columns are exactly spec §6.1, in snake_case in SQL and camelCase in TS. Decisions:
- **Keys:** `uuid` primary keys use `defaultRandom()`. `audit_logs.id` is `bigserial` (mode `number`).
- **Timestamps:** `timestamptz` throughout (`withTimezone: true`). `created_at` defaults to `now()`.
- **Bytes:** `bytea` is a `customType` whose `fromDriver` returns `Buffer.from(value)`. PGlite yields a `Uint8Array` (found in the spike).
- **Enums:** stored as `text` with TS enums: `role` (`admin|member`), `auth_type` (`none|bearer|header`), `last_status` (default `unknown`), `event` (`tool_call|auth_rejected`), `source` (`mcp|chat`), `outcome` (`success|error|timeout|denied|unauthorized`).
- **Foreign keys:**
  - `sessions.user_id` → users, **cascade**.
  - `api_keys.user_id` and `api_keys.created_by` → users, restrict. Users are never deleted, only disabled.
  - `invites.created_by` → users.
  - `audit_logs.user_id` and `audit_logs.server_id` → **set null**.
- **Unique:** `users.email`, `sessions.token_hash`, `api_keys.key_hash`, `invites.token_hash`, `upstream_servers.slug`.
- **Indexes:** `audit_logs(started_at)`, `audit_logs(user_id, started_at)`, `api_keys(user_id)`.
- `upstream_servers` also gets `created_at`.

**Migrations.**
- Generate them with `npx drizzle-kit generate --name init` from `apps/gateway` (config: `dialect: 'postgresql'`, `schema: './src/db/schema.ts'`, `out: './drizzle'`). Commit the SQL and `meta/`.
- `migrate()` resolves the folder as `new URL('../../drizzle', import.meta.url)`, which works from both `src/db` and `dist/db`.
- The PGlite and node-postgres migrators are chosen inside each handle.

- [ ] **Step 1: Write the failing tests.**
  - **`test/config.test.ts`:**
    - A valid env loads.
    - An encryption key that is base64 of 16 bytes → `EnvValidationError` whose message contains `GATEWAY_ENCRYPTION_KEY` and **not** the value.
    - `SEED_SERVERS` that is not JSON → an error naming `SEED_SERVERS`.
    - `SEED_SERVERS` with a slug `Bad_Slug` → an error naming `SEED_SERVERS`.
    - `UPSTREAM_CALL_TIMEOUT_MS=500` → an error.
    - The bootstrap email `" Admin@Example.COM "` → `admin@example.com`.
  - **`test/scaffold.test.ts`**, starting `startGateway` on port 0 with `createTestDb()`:
    - After migration, all six tables exist: `select count(*)` from each returns 0.
    - `GET /healthz` → 200.
    - `GET /readyz` → 200.
    - With a handle whose `ping` resolves `false` → `/readyz` 503.
    - `GET /api/nope` → 404 `{error:{code:'NOT_FOUND', requestId:<uuid>}}`, and the `X-Request-Id` header equals `error.requestId`.
    - `connectWithRetry` with an `open` that fails twice then succeeds (fake `sleep`) → it resolves after 3 attempts.
    - With an `open` that always fails and `attempts: 3` → it rejects with `database not ready after 3 attempts`, and the logger saw 3 warnings without the error's connection string.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test -w @urumi/gateway`. Expected: FAIL.
- [ ] **Step 3: Implement** config, schema, migrations, the handles, `connectWithRetry`, the API error helpers and `startGateway`.
  - `startGateway` calls `startMcpHttpServer` with: `extraRoutes: app => app.use('/api', createApiRouter(deps))`; `readinessCheck: () => deps.db.ping()`; `logPath` replacing any `/api/invites/<x>` segment that is not a UUID with `:token`; a temporary `buildServer` returning an empty `McpServer` (replaced in Task 3.7); and `auth` set to a placeholder that always answers 401. `main.ts` is a stub that exits 1 with `not wired yet` (completed in Task 3.7).
  - `main.ts` will use `connectWithRetry(createPostgresHandle, {attempts: 30, delayMs: 2000})`.
- [ ] **Step 4: Run all checks.** Run `npm test; npm run typecheck; npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit.**
```bash
git add apps/gateway package.json package-lock.json
git commit -m "feat(gateway): scaffold app with config, Drizzle schema, migrations and probes"
```

---

### Task 3.4: Security primitives (crypto, passwords, SSRF guard)

Resolves the "ADR-009 crypto details" carry-forward: a 96-bit random nonce per encryption, and AAD = the server row id.

**Files:**
- Create: `apps/gateway/src/security/{crypto,passwords,ssrf}.ts`
- Test: `apps/gateway/test/security/{crypto,passwords,ssrf}.test.ts`

**Interfaces:**
```ts
export function randomToken(bytes?: number): string;                       // base64url, default 32 bytes
export function sha256Hex(input: string): string;
export function generateApiKey(): { plaintext: string; prefix: string; hash: string };  // ugw_ + base62(32B) padded to 43; prefix = first 12 chars
export function encryptSecret(plain: string, key: Buffer, aad: string): Buffer;  // nonce(12) | ciphertext | tag(16), AES-256-GCM
export function decryptSecret(blob: Buffer, key: Buffer, aad: string): string;    // throws on tamper / wrong aad / short blob
export function hashPassword(p: string): Promise<string>;                  // argon2id, @node-rs/argon2 defaults
export function verifyPassword(hash: string, p: string): Promise<boolean>; // false (never throws) on malformed hash
export class SsrfError extends Error { readonly reason: SsrfReason }
export type SsrfReason = 'invalid_url' | 'scheme' | 'credentials_in_url' | 'dns_failed' | 'loopback' | 'link_local' | 'unspecified' | 'private' | 'not_allowlisted';
export interface SsrfOptions { allowedInternalHosts: string[]; allowLoopback?: boolean; lookup?: (host: string) => Promise<string[]> }
export function assertSafeUpstreamUrl(url: string, o: SsrfOptions): Promise<URL>;
```

**SSRF rules** (spec §9). The checks are applied in this order:
1. **Parse.** The URL must parse, or reason `invalid_url`.
2. **Scheme.** It must be `http:` or `https:` (`scheme`).
3. **No user info.** `user:pass@` is rejected (`credentials_in_url`).
4. **Resolve every address.** Use `lookup` (default `dns.promises.lookup(host, {all: true})`). An IP-literal host is used as-is. A failure gives `dns_failed`.
5. **Check each address.** Unwrap an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) first.
   - **Always rejected:**
     - `0.0.0.0/8` and `::` → `unspecified`;
     - `169.254.0.0/16` and `fe80::/10` → `link_local`.
   - **Loopback** (`127.0.0.0/8`, `::1`) → `loopback`, unless `allowLoopback` is true.
   - **Private ranges** (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`) → `private`, **unless** the hostname matches an `allowedInternalHosts` entry. An entry is an exact name, or `*.suffix`, which matches one or more labels before the suffix.
   - Anything else is public and allowed.

- [ ] **Step 1: Write the failing tests.**
  - **Crypto:**
    - An encrypt/decrypt round trip works.
    - Flipping any byte of the ciphertext throws.
    - Decrypting with a different `aad` throws.
    - Two encryptions of the same text produce different blobs (unique nonce).
    - `generateApiKey().plaintext` matches `/^ugw_[0-9A-Za-z]{43}$/`, `prefix === plaintext.slice(0,12)` and `hash === sha256Hex(plaintext)`.
    - 50 generated keys are all distinct.
  - **Passwords:**
    - hash then verify → true.
    - verify with the wrong password → false.
    - verify against the hash `not-a-hash` → false.
  - **SSRF rejects** (with a fake `lookup` where a name is needed):
    - `http://169.254.169.254/` → `link_local`;
    - `http://localhost/` (lookup → `127.0.0.1`) → `loopback`;
    - `http://[::1]/` → `loopback`;
    - `http://[::ffff:127.0.0.1]/` → `loopback`;
    - `http://2130706433/` (the URL parser makes it `127.0.0.1`) → `loopback`;
    - `file:///etc/passwd` → `scheme`;
    - `http://u:p@example.com/` → `credentials_in_url`;
    - `http://10.0.0.5/` → `private`;
    - `http://evil.example/` resolving to `127.0.0.1` → `loopback` (rebinding);
    - an allowlisted name `x.mcp.svc.cluster.local` resolving to `169.254.169.254` → `link_local`;
    - `http://0.0.0.0/` → `unspecified`;
    - a lookup that throws → `dns_failed`.
  - **SSRF allows:**
    - `http://mcp-notes.mcp.svc.cluster.local:3002/mcp` → `10.43.0.10` (allowlisted);
    - a public IP `http://93.184.216.34/`;
    - `http://127.0.0.1:4000/mcp` with `allowLoopback: true`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test -w @urumi/gateway -- test/security`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:crypto` (`createCipheriv('aes-256-gcm')`, `setAAD`, `randomBytes(12)`), `@node-rs/argon2` (`Algorithm.Argon2id`), and `node:net` `isIP` plus manual CIDR checks. Add no new dependency.
- [ ] **Step 4: Run all checks.** Run `npm test -w @urumi/gateway; npm run typecheck; npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit.**
```bash
git add apps/gateway/src/security apps/gateway/test/security
git commit -m "feat(gateway): add crypto, password hashing and SSRF guard primitives"
```

---

### Task 3.5: Upstream naming, connection, health-checked manager, repository and seeding

Resolves the carry-forward "Gateway upstream timeout above `WOO_TIMEOUT_MS`": `UPSTREAM_CALL_TIMEOUT_MS` defaults to 20000, and Task 3.8 renders it from values with a schema `minimum` of 11000.

**Files:**
- Create: `apps/gateway/src/upstreams/{naming,errors,connection,repository,manager,seed}.ts`, `apps/gateway/src/audit/writer.ts`
- Create: `apps/gateway/test/helpers/fakeUpstream.ts`
- Test: `apps/gateway/test/upstreams/{naming,manager,seed}.test.ts`

**Interfaces:**
- Consumes:
  - from Task 3.1: `startMcpHttpServer`, `UpstreamAuth`;
  - from Task 3.3: `Db`, `schema`;
  - from Task 3.4: `encryptSecret`, `decryptSecret`, `assertSafeUpstreamUrl`, `SsrfOptions`.
- Produces:
```ts
// naming.ts
export const SLUG_RE = /^[a-z][a-z0-9-]{1,15}$/; export const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/; export const TOOL_SEP = '__';
export function toGatewayToolName(slug: string, tool: string): string | null;   // null when the result breaks TOOL_NAME_RE
export function parseGatewayToolName(name: string): { slug: string; tool: string } | null;  // split on FIRST '__'
// errors.ts
export function describeUpstreamError(err: unknown, timeoutMs: number): string;
//  → 'connection refused' | 'DNS lookup failed' | `timeout after ${timeoutMs}ms` | `HTTP ${code} from upstream` |
//    'HTTP 3xx from upstream (redirects are not followed)' | `error: <message, first 200 chars>`  (walks err.cause chain for ECONNREFUSED / ENOTFOUND / EAI_AGAIN)
// audit/writer.ts
export interface AuditEntry { event: 'tool_call' | 'auth_rejected'; source: 'mcp' | 'chat'; userId: string | null; apiKeyId: string | null;
  serverId: string | null; serverSlug: string | null; toolName: string | null; startedAt: Date; durationMs: number;
  outcome: 'success' | 'error' | 'timeout' | 'denied' | 'unauthorized'; errorMessage: string | null }   // errorMessage capped at 500 chars
export class AuditWriter { constructor(db: Db, logger: Logger); record(e: AuditEntry): Promise<void> }  // never throws; logs insert failures
// repository.ts
export interface UpstreamRow { id: string; slug: string; name: string; url: string; authType: 'none' | 'bearer' | 'header'; authHeaderName: string | null;
  credentialEnc: Buffer | null; enabled: boolean; lastStatus: UpstreamStatus; lastError: string | null; lastCheckedAt: Date | null; toolCount: number; createdAt: Date }
export class UpstreamRepository { constructor(db: Db);
  list(): Promise<UpstreamRow[]>; get(id: string): Promise<UpstreamRow | null>; getBySlug(slug: string): Promise<UpstreamRow | null>;
  insert(row: Omit<UpstreamRow, 'lastStatus' | 'lastError' | 'lastCheckedAt' | 'toolCount' | 'createdAt'>): Promise<UpstreamRow>;
  update(id: string, patch: Partial<Pick<UpstreamRow, 'name' | 'url' | 'authType' | 'authHeaderName' | 'credentialEnc' | 'enabled'>>): Promise<UpstreamRow | null>;
  delete(id: string): Promise<boolean>;
  updateHealth(id: string, h: { lastStatus: UpstreamStatus; lastError: string | null; lastCheckedAt: Date; toolCount: number }): Promise<void> }
export function toUpstreamRecord(row: UpstreamRow, encKey: Buffer): UpstreamRecord;   // decrypts with aad = row.id
// connection.ts
export type UpstreamStatus = 'connected' | 'unreachable' | 'disabled' | 'unknown';
export interface UpstreamRecord { id: string; slug: string; name: string; url: string; enabled: boolean; auth: UpstreamAuth }
export interface UpstreamToolInfo { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> }
export class UpstreamConnection { constructor(r: UpstreamRecord, logger: Logger);
  connect(timeoutMs: number): Promise<void>; listTools(timeoutMs: number): Promise<UpstreamToolInfo[]>;
  callTool(tool: string, args: Record<string, unknown>, o: { timeoutMs: number; signal?: AbortSignal }): Promise<CallToolResult>; close(): Promise<void> }
// manager.ts
export interface GatewayTool extends UpstreamToolInfo { serverId: string; serverSlug: string; upstreamName: string }  // name = prefixed, description = '[<Server name>] ' + upstream description
export interface CallContext { userId: string; apiKeyId: string | null; source: 'mcp' | 'chat' }
export interface UpstreamState { status: UpstreamStatus; lastError: string | null; tools: GatewayTool[]; skippedTools: string[]; checkedAt: Date | null }
export class UpstreamManager { constructor(o: { repo: UpstreamRepository; audit: AuditWriter; logger: Logger; encKey: Buffer; ssrf: SsrfOptions;
    healthIntervalMs: number; healthTimeoutMs: number; callTimeoutMs: number; clock?: () => Date });
  start(): Promise<void>;                 // loads all rows, checks every enabled one once, then starts the interval
  stop(): Promise<void>;                  // clears the interval, closes every connection
  upsert(row: UpstreamRow): Promise<void>;// (re)builds the connection for one server and checks it now
  remove(id: string): Promise<void>;
  refresh(id: string): Promise<UpstreamState>;
  listTools(): GatewayTool[];             // enabled AND connected only, sorted by name; never does I/O
  getState(id: string): UpstreamState;    // 'unknown' with empty tools for an id it does not hold
  callTool(gatewayName: string, args: Record<string, unknown>, ctx: CallContext, signal?: AbortSignal): Promise<CallToolResult> }
// seed.ts
export function seedUpstreams(repo: UpstreamRepository, seeds: SeedServer[], env: NodeJS.ProcessEnv, encKey: Buffer, logger: Logger): Promise<{ inserted: string[]; skipped: string[] }>;
//  insert-if-absent by slug; credential from env[seed.credentialEnv], encrypted with aad = the new row id (id generated with randomUUID before insert);
//  a missing/empty credential env → inserted WITHOUT credential + logger.warn naming the env var (never its value)
```

**Behaviour rules** (spec §6.3–6.5, ADR-014):
- **Connections** (`UpstreamConnection`):
  - **Client:** an SDK `Client` with `versionNegotiation: { mode: 'auto' }`, over `StreamableHTTPClientTransport`.
  - **Auth headers:** bearer → `Authorization: Bearer <token>`; header → `<name>: <value>`; none → nothing.
  - **Redirects:** the transport's `fetch` is wrapped to force `redirect: 'manual'` and turn any 3xx into an error. Check the transport option name in the SDK 2.3.1 types, and record it in the code comment.
  - **No token passthrough:** the client's gateway key is **never** sent upstream.
- **Health check** for one server, with the result written via `repo.updateHealth`:
  1. Run the SSRF check (`assertSafeUpstreamUrl`). It happens again at every check, not only on create.
  2. Build a **fresh** connection if none is held or the last check failed.
  3. `connect(healthTimeoutMs)`, then `listTools(healthTimeoutMs)`.
  4. On success: status `connected`, cache replaced, `lastError` null. Invalid names go to `skippedTools`.
  5. On failure: status `unreachable`, cache **dropped**, `lastError` from `describeUpstreamError`, connection closed and discarded.
  - A disabled server → status `disabled`, no connection.
  - A tick skips a server whose previous check is still running.
- **`callTool` outcomes.** Every path calls `audit.record(...)` exactly once and logs one line: `{msg:'tool call', tool, server, outcome, durationMs, userId, source}`, never args or results.
  - **Unparseable name, unknown slug, or tool not in that server's cache** → result `toolError('Unknown tool: <name>')`, outcome `denied`.
  - **Server disabled or not connected** → `toolError("Server '<slug>' is disabled or unreachable")`, outcome `denied`.
  - **Upstream result with `isError`** → returned unchanged, outcome `error`, `errorMessage` = the first text item.
  - **Success** → returned unchanged, outcome `success`.
  - **Timeout** (SDK `RequestTimeout`, or the abort after `callTimeoutMs`) → `toolError("Upstream '<slug>' did not respond within <callTimeoutMs>ms")`, outcome `timeout`.
  - **Connection-level failure** → the server is marked `unreachable` **immediately** (tools dropped, DB mirrored), result `toolError("Upstream '<slug>' is unreachable: <describeUpstreamError>")`, outcome `error`.
  - **Upstream `ProtocolError`** → `toolError("Upstream '<slug>' error: <message>")`, outcome `error`.
  - **No retries.**

**`test/helpers/fakeUpstream.ts`:**
```ts
export interface FakeUpstream { url: string; port: number; calls: { tool: string; headers: Record<string, string | undefined> }[]; stop(): Promise<void> }
export function startFakeUpstream(o: { name: string; tools: string[]; auth: UpstreamAuth; port?: number; slowMs?: number; isErrorTool?: string }): Promise<FakeUpstream>;
//  each tool returns ok(`${name}:${tool}`, { server: name, tool }); `slowMs` delays every call; isErrorTool returns toolError('boom')
//  records the Authorization and x-utilities-key headers it received
export function startRedirectServer(location: string): Promise<{ url: string; stop(): Promise<void> }>;  // plain http, 302 to location
```
`fakeUpstream` uses the real `startMcpHttpServer`.

- [ ] **Step 1: Write the failing tests.**
  - **`naming.test.ts`:**
    - `toGatewayToolName('woo','list_orders')` → `woo__list_orders`.
    - A 70-character tool name → `null`.
    - `toGatewayToolName('a','x.y')` → `null`.
    - `parseGatewayToolName('notes__ping')` → `{slug:'notes',tool:'ping'}`.
    - `parseGatewayToolName('a__b__c')` → `{slug:'a',tool:'b__c'}`.
    - `parseGatewayToolName('noseparator')` → `null`.
    - `parseGatewayToolName('__x')` → `null`.
  - **`manager.test.ts`.** It uses PGlite, `allowLoopback: true`, `healthIntervalMs: 100`, `healthTimeoutMs: 500`, `callTimeoutMs: 1000`, and fakes `a` (bearer `tok-aaaaaaaaaaaaaaaa`, tools `ping,echo`), `b` (header `x-utilities-key`, tools `ping`), `slow` (`slowMs: 3000`, tools `ping`) and `dead` (a closed port).
    1. `listTools` includes `a__ping, a__echo, b__ping, slow__ping` (sorted) and nothing from `dead`. `getState(dead).status === 'unreachable'` with `lastError === 'connection refused'`.
    2. `listTools()` returns in under 200 ms while a `slow__ping` call is in flight.
    3. **Collision.** `a__ping` and `b__ping` both exist and route to their own server: `fakeA.calls` has `ping`, and `fakeB.calls` stays empty after calling `a__ping`.
    4. **Credential placement.** `fakeA` received `Authorization: Bearer tok-aaaaaaaaaaaaaaaa`. `fakeB` received the `x-utilities-key` value and **no** `Authorization` header.
    5. **Timeout.** `slow__ping` → `isError`, with text `Upstream 'slow' did not respond within 1000ms`. The audit row has outcome `timeout` and the right `userId`.
    6. **Disable.** Upserting `a` with `enabled: false` removes its tools. `getState(a).status` becomes `disabled`, and a call to `a__ping` → `isError` `Server 'a' is disabled or unreachable` with audit `denied`.
    7. **Unknown tool.** `zzz__ping` → `isError` `Unknown tool: zzz__ping`, audit `denied`, `serverId` null.
    8. **Review Focus 1.** A fake whose tools are `ok_tool` and `bad.tool` (dot) → `a2__ok_tool` is listed, and `skippedTools` contains `bad.tool`.
    9. **Review Focus 2.** Stop fake `a`, then `refresh(a)` → `unreachable`. Restart a fake on **the same port**, then `refresh(a)` → `connected`, and `a__ping` works.
    10. **Review Focus 3.** A server whose URL is a `startRedirectServer('http://169.254.169.254/')` → `unreachable`, with `lastError` `HTTP 302 from upstream (redirects are not followed)`.
    11. **Connection failure during a call.** Stop fake `b`, then call `b__ping` → `isError` starting `Upstream 'b' is unreachable:`. `listTools()` immediately has no `b__*`, and the DB row `last_status` is `unreachable`.
    12. **Mirroring.** After `start()`, the DB row for `a` has `last_status = 'connected'` and `tool_count = 2`.
    13. **The loop runs.** After `start()` with the interval at 100 ms, stopping a fake makes `vi.waitFor` see `unreachable` within 2 s.
    14. **Upstream `isError`.** A fake with `isErrorTool: 'echo'` → the result is unchanged (`isError`, text `boom`) and the audit row has outcome `error` with `errorMessage` `boom`.
  - **`seed.test.ts`:**
    - Seeding `[woo bearer credentialEnv SEED_WOO_TOKEN]` with that env var set inserts one row. The row's `credentialEnc` decrypts to the value with `aad = row.id`.
    - Seeding again inserts nothing, and the admin-edited `name` survives.
    - A seed whose env var is missing inserts the row with a null credential and warns. The warning names `SEED_X` and contains no value.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test -w @urumi/gateway -- test/upstreams`. Expected: FAIL.
- [ ] **Step 3: Implement** the naming, errors, `AuditWriter`, repository, connection, manager and seeding modules. `describeUpstreamError` must produce the exact strings the tests assert; derive its matching from the real errors the fakes provoke, and put one comment per case naming the SDK error it handles.
- [ ] **Step 4: Run all checks.** Run `npm test -w @urumi/gateway; npm run typecheck; npm run lint`. Expected: all pass, and the suite finishes in under 60 s (no real 20 s timeouts).
- [ ] **Step 5: Commit.**
```bash
git add apps/gateway/src/upstreams apps/gateway/test/upstreams apps/gateway/test/helpers/fakeUpstream.ts
git commit -m "feat(gateway): add tool naming scheme with collision-safe prefixes"
git add apps/gateway/src/upstreams apps/gateway/src/audit/writer.ts apps/gateway/test
git commit -m "feat(gateway): add upstream connection, health-checked manager and seeding"
git commit -m "test(gateway): cover slow, dead, restarted, redirecting and colliding upstreams"   # split as practical
```

---

### Task 3.6: Auth: users, sessions, API keys, invites, internal token, bootstrap, rate limit, routes

Resolves these carry-forwards:
- **Internal token verification.** HS256 only, and `users.disabled_at` re-checked.
- **The `BearerAuthResult` failure variant** carries `apiKeyId`.
- **The internal token part of ADR-010.** Task 3.9 updates the ADR.

**Files:**
- Create: `apps/gateway/src/auth/{users,sessions,apiKeys,invites,internalToken,bearer,middleware,bootstrap,rateLimit}.ts`
- Create: `apps/gateway/src/api/{auth,invites,users,keys}.routes.ts`
- Modify: `apps/gateway/src/api/router.ts`, `apps/gateway/src/server.ts` (`GatewayDeps` gains `rateLimiter`)
- Test: `apps/gateway/test/auth/{bearer,internalToken,rateLimit}.test.ts`, `apps/gateway/test/api/{auth,invites,users,keys}.test.ts`
- Create: `apps/gateway/test/helpers/harness.ts`

**Interfaces:**
```ts
export type Role = 'admin' | 'member';
export interface AuthUser { id: string; email: string; name: string; role: Role }
export type BearerAuthResult =
  | { ok: true; user: AuthUser; apiKeyId: string | null; source: 'mcp' | 'chat' }
  | { ok: false; reason: 'missing' | 'unknown' | 'revoked' | 'disabled' | 'expired'; userId: string | null; apiKeyId: string | null };
export function authenticateBearer(db: Db, header: string | undefined, internalSecret: string, now: Date): Promise<BearerAuthResult>;
//  'ugw_' tokens → sha256 lookup (last_used_at updated on success); anything else → internal JWT; bad signature/aud/iss → 'unknown'; exp → 'expired'
export function mintInternalToken(userId: string, secret: string, ttlSec?: number): Promise<string>;   // default 300
export function verifyInternalToken(token: string, secret: string, now: Date): Promise<{ userId: string } | { error: 'expired' | 'invalid' }>;
export class LoginRateLimiter { constructor(o: { max: number; windowMs: number; clock: () => Date }); hit(key: string): { allowed: boolean; retryAfterSec: number } }  // 10 / 60000
export function ensureBootstrapAdmin(db: Db, email: string, password: string, logger: Logger): Promise<boolean>;  // true when it created the admin (users table was empty)
export function requireSession(deps: GatewayDeps): RequestHandler;   // res.locals.user = AuthUser, else 401 UNAUTHENTICATED; disabled → 401
export function requireRole(role: 'admin'): RequestHandler;          // else 403 FORBIDDEN
export function csrfGuard(publicAppUrl: string): RequestHandler;     // mutating methods: content-type json AND Origin === new URL(publicAppUrl).origin, else 403 CSRF_REJECTED
// test/helpers/harness.ts
export interface Harness { baseUrl: string; deps: GatewayDeps; loginAs(email: string, password: string): Promise<string /* cookie */>; createUser(o: { email: string; role: Role; password?: string; name?: string }): Promise<AuthUser>; close(): Promise<void> }
export function startHarness(o?: { seedAdmin?: boolean; upstreams?: UpstreamRecord[] }): Promise<Harness>;  // PGlite + startGateway on port 0; admin admin@example.com / admin-password-123
```

**Routes.** All bodies are validated with zod. Responses carry no hashes, tokens, `password_hash` or `key_hash`.
- **Shapes:**
  - `UserView`: `{id, email, name, role, disabled, createdAt}`.
  - `KeyView`: `{id, name, prefix, createdAt, lastUsedAt, revokedAt}`.
  - `InviteView`: `{id, email, role, expiresAt, acceptedAt, expired}`.

| Route | Who | Behaviour |
|---|---|---|
| `POST /api/auth/login` `{email,password}` | public | **Rate limit first**, keyed on `ip\|email`; when exceeded → 429 `RATE_LIMITED` with `Retry-After`. A bad email, bad password or disabled user → the same 401 `INVALID_CREDENTIALS` "Email or password is incorrect". Success → 200 `{user}` + `Set-Cookie: ugw_session=…`. |
| `POST /api/auth/logout` | session | Deletes the session row, clears the cookie → 204 |
| `GET /api/auth/me` | session | `{user}` |
| `GET /api/invites/:token` | public | `{email, role, expiresAt}`. An unknown, expired or used token → 404 `INVITE_INVALID` (one message for all three) |
| `POST /api/invites/:token/accept` `{name 1..100, password 10..200}` | public | Creates the user with the invite's email and role, marks the invite accepted and logs them in → 201 `{user}` + cookie. The email already exists → 409 `CONFLICT` |
| `GET /api/invites` | admin | Invites not yet accepted, newest first |
| `POST /api/invites` `{email, role}` | admin | An existing user, case-insensitive (Review Focus 4) → 409. Otherwise → 201 `{invite: InviteView, link}`; the link is shown only here |
| `DELETE /api/invites/:id` | admin | 204, or 404 |
| `GET /api/users` | admin | `UserView[]` |
| `PATCH /api/users/:id` `{role?, disabled?}` | admin | Changing your own role, or disabling yourself → 409 `CONFLICT` "You cannot change your own role or disable yourself". Disabling sets `disabled_at`, deletes the user's sessions and sets `revoked_at` on all their keys. Enabling clears `disabled_at` but does **not** restore keys |
| `GET /api/keys` | session | Own keys, newest first |
| `POST /api/keys` `{name 1..60}` | session | 201 `{key: KeyView, plaintext}`; the plaintext is shown only here |
| `DELETE /api/keys/:id` | session | Revokes your own key → 204. Another user's key → 404 |
| `GET/POST /api/users/:id/keys`, `DELETE /api/users/:id/keys/:keyId` | admin | The same, for a member. `created_by` = the admin |

- **Middleware order on `/api`:** `json({limit:'100kb'})` → `csrfGuard` (mutating methods only) → the route's `requireSession` / `requireRole` → handler.
- **Session lifetime:** expired sessions are rejected and deleted when they are next seen.

- [ ] **Step 1: Write the failing tests.**
  - **`bearer.test.ts`:**
    - No header → `missing`.
    - `Bearer ugw_<random>` that is not stored → `unknown`, with `userId` and `apiKeyId` null.
    - A valid key → ok, `source: 'mcp'`, and `last_used_at` set.
    - A revoked key → `revoked`, with both `userId` and `apiKeyId` set.
    - A key of a disabled user → `disabled`.
    - A minted internal token → ok, `source: 'chat'`, `apiKeyId` null.
    - An internal token for a user disabled after minting → `disabled`.
    - A token signed with another secret → `unknown`.
    - A token with `aud: 'other'` → `unknown`.
    - A token `alg: none` built by hand → `unknown`.
    - A token past `exp` → `expired`.
  - **`rateLimit.test.ts`:** the 11th hit within 60 s → `allowed: false` with `retryAfterSec > 0`. After the window, allowed again (fake clock).
  - **`api/auth.test.ts`** (supertest against the harness):
    - Bootstrap creates the admin once: a second `ensureBootstrapAdmin` → false, and there is 1 user.
    - Login success sets an `HttpOnly; SameSite=Lax` cookie without `Secure`, and `me` returns the admin.
    - Login with `" Admin@Example.COM "` succeeds (Review Focus 4).
    - The wrong password → 401 `INVALID_CREDENTIALS`.
    - The 11th attempt → 429 with `Retry-After`.
    - Logout → `me` 401.
    - A POST with `Origin: http://evil.example` → 403 `CSRF_REJECTED`.
    - A POST without a JSON content type → 403 `CSRF_REJECTED`.
    - No response body contains `password_hash`, `$argon2` or the session token.
  - **`api/invites.test.ts`:**
    - Admin creates an invite → the response link starts with `PUBLIC_APP_URL + '/invite/'`.
    - `GET /api/invites/:token` → 200.
    - Accept → 201, and the cookie works.
    - A second accept → 404 `INVITE_INVALID`.
    - An expired invite (clock + 73 h) → 404.
    - Inviting `ADMIN@example.com` → 409.
    - A member POSTs `/api/invites` → 403.
    - The DB `token_hash` ≠ the token.
  - **`api/users.test.ts`:**
    - A member GETs `/api/users` → 403.
    - The admin disables the member → the member's session gets 401, and their key is `revoked`.
    - The admin demotes themself → 409.
  - **`api/keys.test.ts`:**
    - A member creates a key → the plaintext matches the regex, and the DB holds only `sha256(plaintext)` and `prefix`.
    - `GET /api/keys` has no plaintext.
    - Revoke → `authenticateBearer` gives `revoked` with `userId`.
    - The member DELETEs another user's key → 404.
    - The admin issues a key for the member: `user_id` = member, `created_by` = admin.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test -w @urumi/gateway -- test/auth test/api`. Expected: FAIL.
- [ ] **Step 3: Implement** the auth modules, the routes and the harness. Cookies are parsed by hand from `req.headers.cookie`; add no `cookie-parser` dependency.
- [ ] **Step 4: Run all checks.** Run `npm test -w @urumi/gateway; npm run typecheck; npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit.**
```bash
git add apps/gateway
git commit -m "feat(gateway): add session login, bootstrap admin and rate limiting"
git commit -m "feat(gateway): add invites and user management"
git commit -m "feat(gateway): add hashed per-user API keys with revocation"   # split as practical
```

---

### Task 3.7: Servers API, audit query API, aggregated `/mcp` endpoint, and the gateway entrypoint

Resolves these carry-forwards:
- **HTTP edge cases.** `GET /mcp` → 405 JSON comes from shared. The gateway's public host goes in `MCP_ALLOWED_HOSTS`. Invite paths are redacted in logs (Task 3.3).
- **Per-action logging lives in the gateway audit log.** Failed tool calls are audited as `error`.
- **Verify text and counts:** 15 tools, about 20 s.

**Files:**
- Create: `apps/gateway/src/api/{servers,audit}.routes.ts`, `apps/gateway/src/audit/query.ts`, `apps/gateway/src/mcp/{endpoint,auth}.ts`
- Modify: `apps/gateway/src/server.ts` (`GatewayDeps` gains `upstreams: UpstreamManager`, `audit: AuditWriter` and `repo: UpstreamRepository`), `apps/gateway/src/main.ts` (complete), `test/helpers/harness.ts`
- Test: `apps/gateway/test/api/{servers,audit}.test.ts`, `apps/gateway/test/mcp/endpoint.test.ts`

**Interfaces:**
```ts
export function createMcpAuth(deps: GatewayDeps): RequestHandler;
//  authenticateBearer → ok: res.locals.auth = { user, apiKeyId, source } ; next()
//  fail: if reason !== 'missing' audit {event:'auth_rejected', outcome:'unauthorized', userId, apiKeyId, source:'mcp', toolName:null, serverId:null, serverSlug:null, durationMs:0}
//        → 401 + 'WWW-Authenticate: Bearer' + {jsonrpc:'2.0', error:{code:-32001, message:'Unauthorized'}, id:null}
export function createGatewayMcpServer(deps: GatewayDeps): () => McpServer;
//  new McpServer({name:'urumi-gateway', version}, {capabilities:{tools:{}}});
//  mcp.server.setRequestHandler('tools/list') → { tools: manager.listTools() mapped to {name,title?,description,inputSchema,outputSchema?,annotations?} }
//  mcp.server.setRequestHandler('tools/call') → ctx from mcpRequestLocals.getStore().auth; manager.callTool(name, args ?? {}, ctx, request signal)
//      then mcp.server.projectCallToolResult(result, tool?.outputSchema)  (ADR-007 snippet 4)
export interface AuditQuery { userId?: string; serverSlug?: string; toolName?: string; outcome?: AuditEntry['outcome']; from?: Date; to?: Date; limit: number; cursor?: string }
export function queryAudit(db: Db, q: AuditQuery): Promise<{ items: AuditView[]; nextCursor: string | null }>;   // id DESC; cursor = last id as string
export interface AuditView { id: string; event: string; source: string; userId: string | null; userEmail: string | null; serverSlug: string | null; toolName: string | null; startedAt: string; durationMs: number; outcome: string; errorMessage: string | null }
```

**Servers API** (spec §6.2, §6.6). `ServerView` = `{id, slug, name, url, authType, authHeaderName, hasCredential, enabled, status, lastError, checkedAt, toolCount, tools: {name, description}[], skippedTools: string[]}`. `status` and `tools` come from `manager.getState`.

| Route | Who | Behaviour |
|---|---|---|
| `GET /api/servers`, `GET /api/servers/:id` | session | `ServerView` list / one, or 404 |
| `POST /api/servers` | admin | **Body:** `{slug, name 1..100, url, authType, authHeaderName?, credential? 1..4096}`. **Validation:** the slug must match `SLUG_RE`, or 400; a duplicate slug → 409. `authType: 'header'` needs `authHeaderName` matching `^[A-Za-z0-9-]{1,64}$` and not one of `host`, `content-length`, `content-type`, `authorization`, `cookie`, `connection`, `transfer-encoding`, or 400. `authType: 'none'` must not have a credential, or 400. `assertSafeUpstreamUrl` → `SsrfError` gives 400 `SSRF_REJECTED`, with `details.reason`. **Effect:** encrypt with AAD = the new id, insert, `manager.upsert`, then → 201 `ServerView` |
| `PATCH /api/servers/:id` | admin | **Body:** `{name?, url?, enabled?, authType?, authHeaderName?, credential?, clearCredential?}`. A `slug` in the body → 400 "slug cannot be changed". **Credential:** omitted → kept; `clearCredential: true` → removed. **Effect:** an SSRF check when `url` changes, then `manager.upsert` → 200 `ServerView` |
| `DELETE /api/servers/:id` | admin | `manager.remove` + delete the row → 204. Its audit rows remain, with `server_id` null and `server_slug` kept |
| `POST /api/servers/:id/refresh` | admin | `manager.refresh` → 200 `ServerView` |
| `GET /api/audit` | session | **Query:** `userId, serverSlug, toolName, outcome, from, to, limit (1..100, default 50), cursor`. **Scope:** a member's `userId` is **forced** to their own id (any other `userId` → 403); an admin sees all → `{items, nextCursor}` |

**`main.ts`, in order:**
1. `loadConfig`. An env error exits 1, naming the variables only.
2. `connectWithRetry(createPostgresHandle, {attempts: 30, delayMs: 2000})`.
3. `ensureBootstrapAdmin`.
4. `seedUpstreams(…config.SEED_SERVERS, process.env, …)`.
5. `new UpstreamManager(...)`, then `start()`.
6. `startGateway({...}, {port: config.PORT})`.
7. Log startup without secrets: port, the seeded slugs and the number of upstreams.
8. On SIGTERM: `manager.stop()`, then `server.close()`, then `db.close()`, then exit 0.

The `buildServer` is `createGatewayMcpServer(deps)`, and the `auth` is `createMcpAuth(deps)`.

- [ ] **Step 1: Write the failing tests.**
  - **`mcp/endpoint.test.ts`** (harness with real fake upstreams `woo` (tools `list_orders,ping`) and `notes` (`create_note,ping`), plus an SDK client with `Authorization: Bearer <member key>`):
    1. `tools/list` returns `notes__create_note, notes__ping, woo__list_orders, woo__ping`. The descriptions start with `[WooCommerce] ` or `[Notes] `, and the `inputSchema` is identical to the upstream's.
    2. `woo__list_orders` returns the fake's `structuredContent` unchanged. One audit row: `event tool_call`, `source mcp`, `userId` = member, `apiKeyId` = the key, `serverSlug woo`, `toolName list_orders`, `outcome success`.
    3. Revoking the key with `DELETE /api/keys/:id` makes the next request → HTTP 401 with JSON-RPC `-32001`. An audit row `auth_rejected/unauthorized` is attributed to the member, with the `apiKeyId`.
    4. An unknown `ugw_` key → 401, and an audit row with a null `userId`.
    5. No `Authorization` header → 401, and **no** audit row.
    6. `Host: evil.example` → 403.
    7. `GET /mcp` → 405 JSON with `Allow: POST`.
    8. An internal token (`mintInternalToken`) → `tools/list` works, and a call is audited `source: 'chat'`.
    9. An upstream `isError` result → the client gets `isError`, and the audit outcome is `error`.
    10. **Credential isolation.** The fake upstream's recorded headers contain neither the member's `ugw_` key nor any value starting `ugw_`.
  - **`api/servers.test.ts`:**
    - A member POST → 403.
    - The admin POSTs `{slug:'bad slug'}` → 400 `VALIDATION_FAILED`.
    - `url: 'http://169.254.169.254/mcp'` → 400 `SSRF_REJECTED`.
    - A duplicate slug → 409.
    - Creating with a credential `s3cr3t-cred-value-xyz` → 201, `hasCredential: true`.
    - **The plaintext never appears.** Serialise **every** response of the test (list, get, create, patch, refresh) and assert none contains `s3cr3t-cred-value-xyz`. The DB `credential_enc` doesn't contain it either.
    - A PATCH without a credential keeps it.
    - `clearCredential: true` → `hasCredential: false`.
    - A PATCH with a `slug` → 400.
    - DELETE → 204, the audit rows remain, and `server_slug` is kept.
  - **`api/audit.test.ts`:**
    - A member sees only their own rows. `userId` = another user → 403.
    - The admin filters by `outcome=timeout` and by `serverSlug`.
    - With `limit=2`, the `nextCursor` paging walks all rows exactly once.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test -w @urumi/gateway -- test/mcp test/api`. Expected: FAIL.
- [ ] **Step 3: Implement** the endpoint, the MCP auth, the servers and audit routes and the query, then complete `main.ts` and extend the harness.
- [ ] **Step 4: Run all checks and do one local smoke.** Run `npm test; npm run typecheck; npm run lint`. Then start the local smoke against a real Postgres rather than PGlite:
  - Start a throwaway Postgres: `docker run --rm -d -p 15433:5432 -e POSTGRES_PASSWORD=x postgres:17.11-bookworm`.
  - Run `node apps/gateway/dist/main.js` with `PG*` env and `SSRF_ALLOW_LOOPBACK=true`, with `SEED_SERVERS` pointing at a locally started `mcp-notes`.
  - Expected: it logs `gateway listening`; then login with curl, create a key, and an Inspector CLI `tools/list` shows `notes__*`.
  - Record the commands and outputs in the report, with no secrets. Stop the containers afterwards.
- [ ] **Step 5: Commit.**
```bash
git add apps/gateway
git commit -m "feat(gateway): add server registry API with encrypted credentials and SSRF checks"
git commit -m "feat(gateway): add audit log writer and query API"
git commit -m "feat(gateway): expose aggregated MCP endpoint with per-user auth"   # split as practical
```

---

### Task 3.8: Kubernetes: Postgres, gateway, Notes and Utilities in the chart; images; scripts

Resolves these carry-forwards:
- **`GATEWAY_ENCRYPTION_KEY` via `randBytes 32`.**
- **The gateway copy of `mcp-woocommerce-token`** (canonical namespace `mcp`).
- **Postgres runs as uid 999.**
- **Missing LLM keys must not crash the pod.** **Ruling:** Phase 3 renders **no** LLM env or `llm-api-keys` reference at all. Phase 4 adds it with `optional: true` together with `scripts/create-secrets.ps1`, where it is first used. A single owner for `gateway-bootstrap` is Helm (generated), with `gateway.bootstrapAdminEmail` from values.

**Files:**
- Modify: `docker/node-app.Dockerfile`. In the build stage, `RUN mkdir -p apps/${APP}/drizzle` after the build. In the runtime stage, `COPY --from=build /app/apps/${APP}/drizzle apps/${APP}/drizzle`.
- Modify: `scripts/build-images.ps1`: `$apps = @('mcp-woocommerce','mcp-notes','mcp-utilities','gateway')`.
- Modify: `charts/urumi-platform/templates/_helpers.tpl`:
  - **`urumi.generatedValue`** gains an optional `"random" "bytes"`. Then the value is `randBytes (int .length)`, which is already base64. The default stays `randAlphaNum`.
  - **New `urumi.simpleMcpServer`** (args: `dict root, name, port, values, env` (a list of env entries), `component`) renders a Service + Deployment identical in standards to `mcp-woocommerce.yaml`: probes, uid 1000, a read-only rootfs, `/tmp`, resources from values, `MCP_ALLOWED_HOSTS` built the same way, and `PORT`, `LOG_LEVEL` and the extra env.
- Create: `templates/mcp/mcp-notes.yaml` and `templates/mcp/mcp-utilities.yaml`, both using the helper.
- Modify: `templates/mcp/secrets.yaml`: add `mcp-notes-token` (key `token`, 48 characters) and `mcp-utilities-key` (key `key`, 48 characters), canonical namespace `mcp`, `keep`.
- Create: `templates/gateway/secrets.yaml`, covering these Secrets in namespace `gateway`:
  - **`gateway-secrets`:** `postgres-password` (alnum 32), `encryption-key` (bytes 32) and `internal-token-secret` (alnum 48), canonical namespace `gateway`.
  - **`gateway-bootstrap`:** `email` (from values) and `password` (alnum 20), canonical namespace `gateway`.
  - **Copies:** `mcp-woocommerce-token`, `mcp-notes-token` and `mcp-utilities-key`, each with the **same** canonical namespace `mcp` as the originals.
  - All annotated `keep`, and each skipped when its `secrets.existing.*` is set.
- Create: `templates/gateway/postgres.yaml`:
  - A headless Service `postgres` on 5432 and a StatefulSet `postgres` with 1 replica.
  - Image `postgres:17.11-bookworm`; uid/gid/fsGroup 999.
  - Env: `POSTGRES_USER=gateway`, `POSTGRES_DB=gateway`, `POSTGRES_PASSWORD` from `gateway-secrets`, and `PGDATA=/var/lib/postgresql/data/pgdata`.
  - Probes `exec pg_isready -U gateway -d gateway -h 127.0.0.1` (readiness every 10 s; liveness every 20 s with failureThreshold 6), plus a startupProbe with failureThreshold 30 every 2 s.
  - emptyDirs for `/var/run/postgresql` and `/tmp`; a 1Gi `volumeClaimTemplates` PVC `data`; resources per spec §8.7.
- Create: `templates/gateway/configmap.yaml`: `gateway-config` holds `SEED_SERVERS`, with the JSON built in the template from `namespaces.mcp` and the ports:
  - `woo`, "WooCommerce", `http://mcp-woocommerce.<mcp>.svc.cluster.local:3001/mcp`, bearer, `SEED_WOO_TOKEN`;
  - `notes`, "Notes", `…mcp-notes…:3002/mcp`, bearer, `SEED_NOTES_TOKEN`;
  - `utils`, "Utilities", `…mcp-utilities…:3003/mcp`, header `X-Utilities-Key`, `SEED_UTILS_KEY`.
  - Each seed is included only when its server's `enabled` value is true.
- Create: `templates/gateway/gateway.yaml`: Service `gateway` on 3000, plus a Deployment:
  - uid 1000, a read-only root filesystem, `/tmp`.
  - Env:
    - `PORT`, `LOG_LEVEL`;
    - `PUBLIC_APP_URL` = `urumi.publicUrl` for `appHost`;
    - `COOKIE_SECURE` = `eq publicScheme "https"`;
    - `MCP_ALLOWED_HOSTS` = `appHost`, the `gateway` Service names, `127.0.0.1` and `localhost`;
    - `GATEWAY_ENCRYPTION_KEY`, `GATEWAY_INTERNAL_TOKEN_SECRET` and `BOOTSTRAP_ADMIN_*` from the Secrets;
    - `SEED_SERVERS` from the ConfigMap (`configMapKeyRef`);
    - `SEED_WOO_TOKEN`, `SEED_NOTES_TOKEN` and `SEED_UTILS_KEY` from the gateway-namespace copies;
    - `PGHOST=postgres.<gateway>.svc.cluster.local`, `PGPORT=5432`, `PGDATABASE=gateway`, `PGUSER=gateway`, `PGPASSWORD` from `gateway-secrets`;
    - the `UPSTREAM_*` timeouts from values.
  - Probes `/readyz` (every 10 s) and `/healthz` (every 20 s), and a startupProbe on `/healthz` (failureThreshold 60 every 2 s, which covers the 30×2 s DB retry).
  - A `checksum/config` annotation of the rendered ConfigMap.
- Create: `templates/gateway/ingress.yaml`: Ingress `gateway` for `appHost` with Prefix paths `/api` and `/mcp` → `gateway:3000`, TLS like the store Ingress.
- Modify: `values.yaml` and `values.schema.json`:
  - New blocks `mcpNotes` and `mcpUtilities` (enabled, image.repository/tag, port, logLevel, resources).
  - New block `postgres` (image, storage 1Gi, resources).
  - New block `gateway`: enabled; image; port 3000; logLevel; `bootstrapAdminEmail: admin@example.com`; `healthIntervalMs` 15000; `healthTimeoutMs` 5000; `callTimeoutMs` 20000 (schema minimum 11000); resources.
  - `secrets.existing` gains `mcpNotesToken`, `mcpUtilitiesKey`, `gatewaySecrets` and `gatewayBootstrap`.
- Modify: `deploy/values-prod.yaml`: add the new `secrets.existing` names, with comments on which namespaces each must exist in.
- Modify: `scripts/up.ps1`:
  - The hosts warning also checks `app.localhost`.
  - The fast path also waits for `statefulset/postgres` and `deployment/gateway` in `gateway`, with warning-not-abort, like the MCP wait.
  - The URL block gains these lines:
    - `Gateway API  : <app>/api`
    - `MCP endpoint : <app>/mcp   (needs a personal API key)`
    - `Gateway admin: admin@example.com - copy the password with: powershell -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password`
- Create: `scripts/dev/gateway-smoke.mjs` (Node ESM, SDK client), taking `--base http://app.localhost` and `[--write] [--isolation]` with env `GATEWAY_ADMIN_EMAIL` / `GATEWAY_ADMIN_PASSWORD`. Steps:
  1. Log in with `fetch`, keeping the cookie and sending `Origin` = base.
  2. Create the key `gateway-smoke <ISO>`, held in memory only.
  3. An MCP `tools/list` over `<base>/mcp` → assert exactly 15 tools: 6 `woo__`, 5 `notes__`, 4 `utils__`.
  4. Call `utils__ping`, `notes__ping` and `woo__ping`, then `woo__list_orders {period:'today'}` and `utils__calculate {expression:'2+3*4'}` (result 14).
  5. With `--write`, also `notes__create_note {title:'Gateway smoke', content:'<ISO>'}` and `notes__search_notes {query:'Gateway smoke'}`.
  6. With `--isolation`:
     - `kubectl -n mcp scale deploy/mcp-utilities --replicas=0` (via `child_process.execFileSync`);
     - poll `tools/list` every 2 s for up to 45 s until no `utils__` tool remains, then assert `woo__ping` still works;
     - scale back to 1 and poll until the `utils__` tools return (up to 90 s).
  7. Revoke the key, assert the next `tools/list` → 401, then `GET /api/audit?limit=20` → there are rows for the calls, attributed to the admin.
  8. Print compact lines; **never** print the key, the password or the cookie. Exit 0 or 1.
- Create: `scripts/check-gateway.ps1 [-Write] [-Isolation]`:
  1. Check the prerequisites: `kubectl` and `node`, plus `node_modules/@modelcontextprotocol/client`, as in `check-mcp-woocommerce.ps1`.
  2. Check that `app.localhost` resolves (`Resolve-DnsName` or `[System.Net.Dns]::GetHostAddresses`). If not, stop with the `setup-hosts.ps1` hint.
  3. Read `gateway-bootstrap` `email` and `password` into env vars without printing them.
  4. Run the smoke script, then clear the env vars in `finally` and exit with node's exit code.

- [ ] **Step 1: Render and lint.** Run `helm lint charts/urumi-platform -f deploy/values-local.yaml` and the same with `deploy/values-prod.yaml`. Then run `helm template … -f deploy/values-local.yaml` and confirm:
  - The two `mcp-woocommerce-token` copies (`mcp`, `gateway`) render identical data, and the same holds for the notes and utilities copies.
  - The `encryption-key` value base64-decodes to a 44-character base64 string that decodes to 32 bytes.
  - `SEED_SERVERS` is valid JSON with 3 entries.
  - Ingress `gateway` has `/api` and `/mcp` for `app.localhost`.
  - Every container has probes, resources and the security context. Check with a `grep -c` count per kind, and record it.
- [ ] **Step 2: Deploy.** Commit first, so the image tag is clean. Run `scripts\up.ps1 -Redeploy`. Expected:
  - 4 images are built and imported.
  - `kubectl -n gateway get pods` shows `postgres-0` and `gateway-…` at `1/1 Running`.
  - `kubectl -n mcp get pods` shows three MCP servers at `1/1`.
  - The gateway log has `seeded` with `woo,notes,utils`, and no secrets.
- [ ] **Step 3: Run the end-to-end check.** Run `scripts\check-gateway.ps1`, then `-Write`, then `-Isolation`. All pass, and the output shows 15 tools, the isolation timings and the audit rows. Record the timings: the tools should disappear within about 20 s and return after the pod is Ready.
- [ ] **Step 4: Persistence.** Run `kubectl -n gateway delete pod postgres-0`, wait for it to be Ready, then rerun `check-gateway.ps1`. It passes: users, keys and audit rows survived, and the bootstrap did not run again (the gateway log shows no `bootstrap admin created`).
- [ ] **Step 5: Inspector against the gateway.**
  - Create a key with the PowerShell snippet that Task 3.9 documents: `Invoke-RestMethod` login with `-WebSession`, then `POST /api/keys`.
  - Run `npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://app.localhost/mcp --transport http --header "Authorization: Bearer $env:UGW_KEY" --method tools/list` → 15 tools.
  - Run `--method tools/call --tool-name woo__list_orders --tool-arg period=today` → orders.
  - Load the key into the env var without printing it.
- [ ] **Step 6: Commit.**
```bash
git add docker scripts/build-images.ps1 charts/urumi-platform deploy/values-prod.yaml
git commit -m "feat(helm): deploy gateway, Postgres, notes and utilities MCP servers with seeded upstream registry"
git add scripts
git commit -m "feat(scripts): add gateway end-to-end and isolation check; show gateway URLs in up.ps1"
```

---

### Task 3.9: Documentation, learning notes and plan bookkeeping

**Files:**
- Create:
  - `docs/system-design.md`
  - `docs/error-handling.md`
  - `docs/security.md` (partial; complete in Phase 5)
  - `docs/testing.md`
  - `docs/learning/03-gateway.md`
  - `apps/gateway/README.md`
- Modify:
  - `docs/run-guide.md`
  - `docs/workflows.md`
  - `docs/architecture.md`
  - `docs/troubleshooting.md`
  - `docs/deployment.md`
  - `docs/README.md`
  - `docs/diagrams/README.md`
  - `README.md`
  - ADR-006, 008, 009, 010, 013 and 014: status "Implemented in Phase 3", plus any as-built detail
  - the spec: §6.1 (bytea / PGlite), §6.2 (`ServerView`, `skippedTools`), §8.4 (Secret keys), §11 (PGlite instead of a Postgres container)
  - the master plan: tick every Phase 3 carry-forward with "→ Task 3.x", and update the Phase 4 interface notes that Phase 3 changed (for example: `startGateway` instead of `createApp`; `GatewayDeps` has no `llm` yet; the internal token is already built)

**Content (each item verified, or labelled "expected" / "not tested"):**
- **Run guide.**
  - New section "The gateway (Phase 3)", replacing the "(planned)" Postgres section, covering:
    - the URLs, and what is not built yet (the dashboard and chat are Phase 4);
    - how to get the admin password (`get-secret.ps1`);
    - how to log in and create an API key with PowerShell 5.1 (`Invoke-RestMethod`, `-WebSession`, the `Origin` header);
    - how to connect MCP Inspector, Claude Code (`claude mcp add --transport http …`; mark it **for the user to try**) and Cursor (`mcp.json` snippet; **not tested**);
    - how to invite a teammate with the API (the link is shown once);
    - the end-to-end and isolation checks.
  - "Viewing the gateway database (Postgres)":
    - `kubectl -n gateway exec -it postgres-0 -- psql -U gateway gateway`, with the piped single-query form for PowerShell 5.1;
    - a GUI route via `kubectl -n gateway port-forward svc/postgres 15432:5432` plus `get-secret.ps1 … postgres-password`;
    - a table guide with useful read-only queries (users, keys without hashes, servers status, the latest audit rows);
    - a warning: `credential_enc` is encrypted, and you never need `key_hash`.
  - Update the "each part" table so the gateway, Postgres, notes and utilities are Available.
- **Workflows**, each with a Mermaid diagram, its explanation and a failure table:
  - "Register an upstream and how it appears in `tools/list`"
  - "MCP tool call through the gateway" (from spec §6.5, as built)
  - "API key lifecycle (create, use, revoke)"
  - "Invite a teammate"
  - "Upstream goes down and comes back"
- **`system-design.md`:** components, data model (ER diagram), interfaces (`/api` table, `/mcp`), the upstream manager state machine, naming, timeouts, trade-offs, and per-replica state limits.
- **`error-handling.md`:** every failure in spec §10, plus the 401 / 403 / 405 / 413 / SSRF / rate-limit cases from the code: detection, propagation, retry or not, what the user sees, and the logs and audit rows produced.
- **`security.md`** (partial). Cover:
  - credential separation and no token passthrough;
  - hashing versus encryption (ADR-008/009);
  - sessions, CSRF and the rate limit;
  - the SSRF rules and `SSRF_ALLOW_LOOPBACK` (dev and tests only);
  - log redaction and invite-path redaction;
  - what a member can and cannot do;
  - residual risks.
  Mark NetworkPolicies and the threat model as Phase 5/6.
- **`testing.md`:** the test layers and the commands per workspace, what each suite proves (with test counts from the actual run), how the fake upstreams work, and the cluster checks (`check-mcp-woocommerce.ps1`, `check-gateway.ps1 -Write -Isolation`).
- **`learning/03-gateway.md`** (for the interview):
  - the gateway as client and server;
  - the cached catalog versus fan-out;
  - collision naming;
  - hashing versus encryption;
  - the auth flow;
  - **real JSON captured from the gateway**: `tools/list` (trimmed), a routed `tools/call`, a 401 and a timeout `isError`. Redact all secrets.
- **Troubleshooting entries:**
  - gateway CrashLoop with `database not ready after 30 attempts`;
  - `EnvValidationError` names;
  - 401 from `/mcp` (key revoked or user disabled);
  - 403 `CSRF_REJECTED` with curl or PowerShell (Origin missing);
  - 429 login;
  - an upstream `unreachable` with each `lastError` string;
  - `app.localhost` not resolving for Node;
  - Postgres `PGDATA` permission errors;
  - the `ErrImagePull` path for the new images.
- **`README.md`:** features and the quick start for the gateway, linking to the run guide.

**Rules:**
- The relative-link check reports 0 broken.
- The secret scan finds no `ugw_` followed by 43 characters, no cookie values, and no base64 32-byte keys.
- Mermaid labels are quoted when they contain `:` or `()`.

- [ ] **Step 1: Write the docs**, capturing the JSON live from the running cluster (port-forward not needed: `http://app.localhost/mcp` with a temporary key that is revoked afterwards).
- [ ] **Step 2: Run the link check and the secret scan.** Expected: 0 broken links and 0 secret hits. Record the commands and output.
- [ ] **Step 3: Commit.**
```bash
git add docs/learning/03-gateway.md apps/gateway/README.md docs/system-design.md docs/error-handling.md docs/security.md docs/testing.md
git commit -m "docs: add gateway system design, error handling, security and testing docs with captured MCP traffic"
git add docs README.md
git commit -m "docs: add gateway to run guide, workflows and troubleshooting; record Phase 3 decisions"
```

## Phase 3 exit check (the user runs it)

1. Run `powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`. The URL block shows the Gateway API, the MCP endpoint and the admin line.
2. Check the pods:
   - `kubectl -n gateway get pods,svc,ingress`: `postgres-0` and `gateway` are Running; the Ingress host is `app.localhost`.
   - `kubectl -n mcp get pods`: 3 MCP servers are Running.
3. Run `scripts\check-gateway.ps1 -Write -Isolation`. Expected: 15 tools; calls routed to all three upstreams; the `utils__` tools disappear when the pod is scaled to 0 while `woo__ping` keeps working; they come back; the revoked key gets 401; the audit rows are listed.
4. **Optional:** create a personal key (run guide) and connect MCP Inspector or Claude Code to `http://app.localhost/mcp`. Call `woo__list_orders {"period":"today"}` and `notes__create_note`.
5. Open the gateway database (run guide) and see your user, your key prefix, the three servers `connected`, and the audit rows for your calls.
6. Run `npm test`, `npm run typecheck` and `npm run lint`. All pass.

## Carry-forward mapping (master plan → this plan)

| Phase 3 carry-forward item | Resolved in |
|---|---|
| `type Db` union will not type-check | 3.3 (`PgDatabase<PgQueryResultHKT, typeof schema>`, proven in the spike); spec §11 aligned in 3.9 |
| `GATEWAY_ENCRYPTION_KEY` 32 random bytes base64, validated at startup | 3.3 (config check), 3.8 (`generatedValue` `random: bytes`) |
| `audit_logs.server_id` `ON DELETE SET NULL` | 3.3 (schema), 3.7 (DELETE test) |
| Internal token `algorithms: ['HS256']`, re-check `disabled_at` | 3.6 (`bearer.test.ts`), ADR-010 updated in 3.9 |
| ADR-009: 96-bit nonce, AAD = server row id | 3.4, 3.5, 3.7 |
| `BearerAuthResult` failure carries `apiKeyId` | 3.6 |
| `AppDeps.llm` before Phase 4 | 3.3 ruling: no LLM dependency in Phase 3; Phase 4 adds it |
| Missing LLM keys must not crash the pod; `create-secrets.ps1`; `gateway-bootstrap` owner; LLM_*/BOOTSTRAP_* mapping | 3.8 ruling: no LLM env in Phase 3 (Phase 4 adds an `optional: true` ref and `create-secrets.ps1`); `gateway-bootstrap` is owned by Helm; `gateway.bootstrapAdminEmail` value |
| HTTP edge cases (405 JSON, loopback in allowedHosts, invite-path redaction) | 3.1 (`logPath`, request id), 3.3 (redacting `logPath`), 3.7 (405 test), 3.8 (`MCP_ALLOWED_HOSTS`) |
| Verify text: about 20 s, 15 tools | 3.7 / 3.8 (the smoke asserts 15; isolation polls up to 45 s) |
| Extend `startMcpHttpServer`, do not fork it | 3.1 |
| Gateway upstream timeout > `WOO_TIMEOUT_MS` | 3.5 (default 20000), 3.8 (schema minimum 11000) |
| Gateway copy of `mcp-woocommerce-token` | 3.8 (canonical namespace `mcp`) |
| Tests for malformed JSON and 413 | 3.1 |
| Consider logging aborted requests | 3.9 ruling: documented as a known limit (the audit row is written after the call; a crash mid-call has no row, spec §6.8); no code change |
| Per-action logging in the gateway audit log | 3.5 (`tool call` log line plus an audit row on every path), 3.7 (`isError` → outcome `error` test) |

## Self-review

- **Spec coverage:**
  - §5.3 → 3.2
  - §6.1 → 3.3
  - §6.2 → 3.6, 3.7
  - §6.3 / §6.4 / §6.5 → 3.5, 3.7
  - §6.6 → 3.4, 3.5, 3.7
  - §6.7 → 3.6, 3.5 (seed)
  - §6.8 → 3.5 (writer), 3.7 (auth_rejected, query)
  - §8.1 / §8.4 / §8.5 / §8.7 → 3.8
  - §9 → 3.4, 3.6, 3.7, 3.9
  - §10 → 3.5, 3.7, 3.9
  - §11 → tests in every task, plus 3.8 (cluster checks)
  - §6.9 / §6.10 / §7 → Phase 4. The internal token is built here because `/mcp` auth owns it.
- **Type consistency:**
  - `UpstreamAuth` (shared) is reused by 3.2, 3.5 and the fakes.
  - `CallContext.source`, `BearerAuthResult.source` and `AuditEntry.source` are all `'mcp' | 'chat'`.
  - `UpstreamStatus` is the same in the repository, the manager, `ServerView` and the schema.
  - `GatewayDeps` grows by addition only: 3.3 (`config, logger, db, clock`), then 3.6 (`rateLimiter`), then 3.7 (`upstreams, audit, repo`).
- **Proportion:** interfaces, rules and test assertions only. The function bodies are left to the implementers, except the calculator grammar and the SSRF rule order, which the tests alone do not determine.
