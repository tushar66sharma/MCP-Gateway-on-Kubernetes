# gateway

The team MCP gateway (Phase 3). One Node 24 / Express 5 / TypeScript process that is an MCP **server** for your AI clients and an MCP **client** of the upstream servers (WooCommerce, Notes, Utilities). It owns users, API keys, invites, the upstream registry and the audit log, all in its own Postgres database.

Not built yet (Phase 4): the dashboard, `POST /api/chat` and the LLM layer. Everything below exists and was run.

How to run and inspect it: [docs/run-guide.md](../../docs/run-guide.md#9-the-gateway-phase-3). Design: [docs/system-design.md](../../docs/system-design.md). Security: [docs/security.md](../../docs/security.md).

## Endpoints

| Path | Who | What |
|---|---|---|
| `POST /mcp` | API key (`ugw_...`) or the internal chat token | The aggregated MCP endpoint: `tools/list` from the cached catalog, `tools/call` routed to the owning upstream. `GET /mcp` answers 405. |
| `/api/...` | session cookie `ugw_session` (some routes public or admin only) | Login, invites, users, API keys, servers, audit. Full table: [system-design.md](../../docs/system-design.md#3-interfaces). |
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
| `SEED_SERVERS` | no | `[]` | JSON array of upstreams inserted at start if their slug is absent: `{slug,name,url,authType,authHeaderName?,credentialEnv?}`. `credentialEnv` names the environment variable that holds the credential. |
| `SSRF_ALLOWED_INTERNAL_HOSTS` | no | `*.mcp.svc.cluster.local` | Names allowed to resolve to private addresses: exact names with at least one dot, or `*.suffix` with at least two labels after `*.` (checked at start). |
| `SSRF_ALLOW_LOOPBACK` | no | `false` | **Development and tests only.** Allows upstream URLs that resolve to loopback. The Helm chart never sets it. |
| `UPSTREAM_HEALTH_INTERVAL_MS` | no | `15000` | Health-check period (1000-300000). |
| `UPSTREAM_HEALTH_TIMEOUT_MS` | no | `5000` | Timeout of one health check (500-60000); must be below `UPSTREAM_HEALTH_INTERVAL_MS`. |
| `UPSTREAM_CALL_TIMEOUT_MS` | no | `20000` | Timeout of one tool call (11000-120000): above `WOO_TIMEOUT_MS` (10000), enforced here and by the chart schema. |

## Startup order (`src/main.ts`)

1. Load and validate the configuration.
2. Connect to Postgres, ping and run the migrations in `drizzle/`, up to 30 attempts 2 s apart. If all fail the process exits non-zero (Kubernetes restarts it). `/mcp` is never served on an unmigrated database.
3. Create the bootstrap admin if there are no users.
4. Insert each seed server whose slug is in neither `upstream_servers` nor `seeded_slugs`, recording the slug in `seeded_slugs` in the same transaction. A seed never overwrites a row, so admin edits survive restarts, and a deleted built-in server stays deleted (re-add it with `POST /api/servers`).
5. Run one health check per server, then start the 15 s interval.
6. Listen. On `SIGTERM` or `SIGINT`: stop the checks and upstream clients, stop listening, close the pool, exit 0.

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
| `test/` | Vitest suites on PGlite (an in-process Postgres) and in-process fake upstreams, see [docs/testing.md](../../docs/testing.md). |

## Development

```powershell
npm test -w @urumi/gateway          # 202 tests, about 45-60 s
npm run typecheck -w @urumi/gateway
npm run build -w @urumi/gateway
npm run db:generate -w @urumi/gateway   # after changing src/db/schema.ts; commit the new SQL in drizzle/
```

To run it against a throwaway local Postgres you need every required variable above; the easiest check of a real deployment is `scripts\check-gateway.ps1` ([run guide](../../docs/run-guide.md#9-the-gateway-phase-3)).

## Known limits

- Health and catalog state is held in memory per replica, and a server edit is applied on the replica that handled it. One replica is deployed.
- The login rate limiter is in memory per replica.
- There is no rate limit on `/mcp` yet (Phase 5); see [security.md](../../docs/security.md#8-residual-risks).
- The audit row for a tool call is written after the call finishes. A crash in the middle leaves no row.
