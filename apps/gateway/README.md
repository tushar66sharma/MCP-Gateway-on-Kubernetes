# gateway

The team MCP gateway (Phase 3, chat agent since Phase 4). One Node 24 / Express 5 / TypeScript process that is an MCP **server** for your AI clients and an MCP **client** of the upstream servers (WooCommerce, Notes, Utilities). It owns users, API keys, invites, the upstream registry and the audit log, all in its own Postgres database, and runs the dashboard's **chat agent** (`POST /api/chat`): an LLM tool loop that calls the gateway's own `/mcp` as the logged-in user. The dashboard itself is a separate app ([apps/dashboard](../dashboard/README.md)). Everything below exists and was run.

How to run and inspect it: [docs/run-guide.md](../../docs/run-guide.md#9-the-gateway-phase-3). Design: [docs/system-design.md](../../docs/system-design.md). Security: [docs/security.md](../../docs/security.md). The LLM layer and the chat: [docs/ai-integration.md](../../docs/ai-integration.md).

## Endpoints

| Path | Who | What |
|---|---|---|
| `POST /mcp` | API key (`ugw_...`) or the internal chat token | The aggregated MCP endpoint: `tools/list` from the cached catalog, `tools/call` routed to the owning upstream. `GET /mcp` answers 405. |
| `/api/...` | session cookie `ugw_session` (some routes public or admin only) | Login, invites, users, API keys, servers, audit, and `GET /api/chat/status` and `POST /api/chat` (Phase 4). Full table: [system-design.md](../../docs/system-design.md#3-interfaces). Every `/api` response carries `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. |
| `GET /healthz` | anyone | Liveness: the process is up. |
| `GET /readyz` | anyone | Readiness: 200 only when Postgres answers `select 1` (503 otherwise). It does not wait for upstreams. |

Every response carries an `X-Request-Id`. API errors have the shape `{"error":{"code","message","details"?,"requestId"}}`.

## Configuration (environment variables)

A missing or invalid variable stops the process at start with a message that lists variable **names** only (`Invalid environment: ...`). In the cluster the Helm chart sets all of these; see `charts/urumi-platform/templates/gateway/gateway.yaml`.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PUBLIC_APP_URL` | yes | | Public origin, for example `http://app.localhost`. The CSRF `Origin` check and invite links use it. |
| `GATEWAY_ENCRYPTION_KEY` | yes | | Base64 of exactly 32 bytes (AES-256-GCM key for upstream credentials). |
| `GATEWAY_INTERNAL_TOKEN_SECRET` | yes | | At least 32 characters; signs the 5-minute chat token. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | yes | | The first admin, created only when the `users` table is empty (password 10-200 characters). |
| `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | yes | | Read by the `pg` driver. `PGPORT` defaults to 5432. |
| `PORT` | no | `3000` | Listen port. |
| `LOG_LEVEL` | no | `info` | pino level. |
| `COOKIE_SECURE` | no | `false` | `true` adds `Secure` to the session cookie (Helm sets it from the public scheme). |
| `MCP_ALLOWED_HOSTS` | no | `localhost,127.0.0.1` | `Host` header allow-list for `/mcp` (names without ports). |
| `TRUST_PROXY` | no | `0` | Reverse-proxy hops whose `X-Forwarded-For` is believed. Helm sets `1` (Traefik). Only the login rate limit reads it. |
| `SEED_SERVERS` | no | `[]` | JSON array of built-in upstreams, each inserted once ever (a slug recorded in `seeded_slugs` is never re-inserted, so a deleted built-in server stays deleted): `{slug,name,url,authType,authHeaderName?,credentialEnv?}`. `credentialEnv` names the environment variable that holds the credential. |
| `SSRF_ALLOWED_INTERNAL_HOSTS` | no | `*.mcp.svc.cluster.local` | Names allowed to resolve to private addresses: exact names with at least one dot, or `*.suffix` with at least two labels after `*.` (checked at start). |
| `SSRF_ALLOW_LOOPBACK` | no | `false` | **Development and tests only.** Allows upstream URLs that resolve to loopback. The Helm chart never sets it. |
| `UPSTREAM_HEALTH_INTERVAL_MS` | no | `15000` | Health-check period (1000-300000). |
| `UPSTREAM_HEALTH_TIMEOUT_MS` | no | `5000` | Timeout of one health check (500-60000); must be below `UPSTREAM_HEALTH_INTERVAL_MS`. |
| `UPSTREAM_CALL_TIMEOUT_MS` | no | `20000` | Timeout of one tool call (11000-120000): above `WOO_TIMEOUT_MS` (10000), enforced here and by the chart schema. |
| `LLM_PROVIDER` | no | `groq` | Chat model provider: `groq` or `openrouter` (Phase 4). |
| `LLM_MODEL` | no | `""` | Model id; empty = the provider's default (`openai/gpt-oss-120b` on Groq, `nvidia/nemotron-3-super-120b-a12b:free` on OpenRouter). |
| `LLM_BASE_URL` | no | `""` | Overrides the primary provider's API URL (`http(s)` URL or empty). |
| `LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL` | no | `""` | A provider tried once, with no retries, when the primary is rate limited or unavailable; must differ from `LLM_PROVIDER`. |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | no | `""` | Provider keys, from the Secret `llm-api-keys` (optional). No key for `LLM_PROVIDER` = chat answers `503 LLM_NOT_CONFIGURED`; the gateway still starts. |
| `LLM_TIMEOUT_MS` | no | `30000` | One request to the provider (5000-120000). |
| `LLM_MAX_RETRIES` | no | `2` | Retries on 429, 5xx and network errors (0-5), never past the turn deadline. |
| `CHAT_TURN_TIMEOUT_MS` | no | `60000` | One whole chat turn (10000-120000). |
| `CHAT_MAX_STEPS` | no | `8` | Tool steps per turn (1-16). |
| `CHAT_RATE_LIMIT_PER_MIN` | no | `10` | Chat turns per user per minute (1-120); one turn per user at a time regardless. |
| `MCP_AUTH_FAILURE_LIMIT_PER_MIN` | no | `30` | Audited `/mcp` authentication failures per client IP per minute (1-1000); over it the gateway answers `429` with `Retry-After`. A valid credential is never limited. |
| `STORE_TIMEZONE` | no | `UTC` | IANA zone the chat's system prompt uses for "today" (validated; the chart passes `storeSetup.timezone`). |

## Startup order (`src/main.ts`)

1. Load and validate the configuration, and build the LLM provider: it logs `llm configured: <provider>/<model>` or warns `llm not configured: chat is disabled (no API key for the provider)` (names only, never a key).
2. Connect to Postgres, ping and run the migrations in `drizzle/`, up to 30 attempts 2 s apart. If all fail the process exits non-zero (Kubernetes restarts it). `/mcp` is never served on an unmigrated database.
3. Create the bootstrap admin if there are no users.
4. Insert each seed server whose slug is in neither `upstream_servers` nor `seeded_slugs`, recording the slug in `seeded_slugs` in the same transaction. A seed never overwrites a row, so admin edits survive restarts, and a deleted built-in server stays deleted (re-add it with `POST /api/servers`).
5. Run one health check per server, then start the 15 s interval.
6. Listen. On `SIGTERM` or `SIGINT`: stop accepting connections, wait up to 25 s for in-flight requests, cut any still open, stop the health checks and upstream clients, close the pool, exit 0. In Kubernetes a 5 s `preStop` sleep runs first and the pod has a 35 s termination grace period.

## Source layout

| Folder | Holds |
|---|---|
| `src/api/` | The `/api` routers, the error shape and zod body/query helpers. |
| `src/auth/` | Users, sessions, API keys, invites, the internal token, `/mcp` bearer check, rate limiter, bootstrap. |
| `src/security/` | AES-GCM and hashing (`crypto.ts`), argon2id (`passwords.ts`), the SSRF guard (`ssrf.ts`). |
| `src/upstreams/` | Naming, error descriptions, one upstream connection, the repository, the manager (health loop and routing), seeding. |
| `src/audit/` | The audit writer and the audit query. |
| `src/mcp/` | The gateway's own MCP server factory and the `/mcp` auth middleware. |
| `src/db/` | The Drizzle schema, the Postgres client and the migrator. |
| `src/chat/` | The chat agent (Phase 4): `agent.ts` (the tool loop and its limits), `service.ts` (per-user limits, turn timeout, the `chat turn` log line), `mcpLoopback.ts` (`connectLoopback(mcpUrl, mintToken)`: an MCP client to the gateway's own `/mcp` with a fresh internal token per request), `systemPrompt.ts`. |
| `src/chat/llm/` | The provider-independent LLM layer: `types.ts`, `errors.ts`, `providers.ts` (Groq, OpenRouter), `openaiCompatible.ts` (the one adapter: retries, backoff, deadline), `registry.ts` (primary plus one-shot fallback). |
| `test/` | Vitest suites on PGlite (an in-process Postgres), in-process fake upstreams and a scripted fake LLM, see [docs/testing.md](../../docs/testing.md). |

## Development

```powershell
npm test -w @urumi/gateway          # 293 tests in 26 files, about 45-65 s
npm run typecheck -w @urumi/gateway
npm run build -w @urumi/gateway
npm run db:generate -w @urumi/gateway   # after changing src/db/schema.ts; commit the new SQL in drizzle/
```

To run it against a throwaway local Postgres you need every required variable above; the easiest check of a real deployment is `scripts\check-gateway.ps1` ([run guide](../../docs/run-guide.md#9-the-gateway-phase-3)).

## Known limits

- Health and catalog state is held in memory per replica, and a server edit is applied on the replica that handled it. One replica is deployed.
- The login, chat and `/mcp` failure limiters are in memory per replica, each capped at 10,000 keys (the oldest inserted key is evicted).
- `/mcp` limits only recognised failures per client IP (`MCP_AUTH_FAILURE_LIMIT_PER_MIN`); unrecognised garbage is a plain `401` and a flood of it still costs a database lookup per request; see [security.md](../../docs/security.md#8-residual-risks).
- Migrations run under a Postgres advisory lock (`MIGRATION_LOCK_KEY`), so replicas never migrate at once.
- The audit row for a tool call is written after the call finishes. A crash in the middle leaves no row.
- Chat: a failure of the loopback connect or `tools/list` answers a generic `500 INTERNAL`; a client disconnect is logged as `stoppedReason: timeout`; the loopback connect has its own 10 s timeout and does not follow the turn signal. The model sees tool output as untrusted data, but prompt injection remains a residual risk ([security.md](../../docs/security.md#12-untrusted-data-and-prompt-injection)).
- `scripts/dev/llm-probe.mjs` compares models' tool calling against the captured 15-tool catalogue (`test/fixtures/gateway-tools.json`); it reads the key from `.env` and prints only `set`.
