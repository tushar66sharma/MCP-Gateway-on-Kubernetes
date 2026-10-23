# mcp-woocommerce

An MCP (Model Context Protocol) server that lets an AI client read and change a WooCommerce store: list and create products, list orders, read one order, change an order's status. It is a small Node 24 + TypeScript service that exposes `POST /mcp` and calls the WooCommerce REST API v3, signing each request with OAuth 1.0a. For a store hosted elsewhere it can instead use HTTP Basic over HTTPS (`WOO_AUTH_MODE=basic`, https only).

It runs in the Kubernetes namespace `mcp` and is **internal only** (a ClusterIP Service, no Ingress). External clients will reach it through the gateway in Phase 3. How to run and inspect it day to day: [run guide, section 8](../../docs/run-guide.md#8-woocommerce-mcp-server-phase-2). Protocol walkthrough with real captured traffic: [docs/learning/02-mcp-protocol.md](../../docs/learning/02-mcp-protocol.md).

## Tools

All inputs are validated with zod before the handler runs. Results carry both `content` (text for the model) and `structuredContent` (JSON for programs). A failure returns `isError: true` with a short message (no stack traces, no credentials).

| Tool | Input | Notes |
|---|---|---|
| `list_products` | `search?` (max 100 chars), `status?` (`publish`, `draft`, `pending`, `private`, `any`; default `any`), `page?` (1-1000, default 1), `per_page?` (1-50, default 10) | Returns id, name, status, price, regular_price, stock_status, permalink. |
| `create_product` | `name` (1-200 chars), `regular_price` (a string like `"12"` or `"12.50"`, or a JSON number like `12.5`; non-negative, at most 2 decimals), `description?`, `status?` (`publish` or `draft`, default `publish`) | Creates a simple product. Numbers are sent to WooCommerce as 2-decimal strings (`12.5` becomes `"12.50"`); a value such as `12.555` is refused, not rounded. **Not idempotent**: calling twice creates two products. |
| `list_orders` | `period?` (`today`, `yesterday`, `last_7_days`) **or** `after?`/`before?` (ISO 8601 date-time with `Z` or an offset, e.g. `2026-10-18T00:00:00+05:30`; a bare date is refused), `status?`, `page?` (1-1000), `per_page?` (1-50, default 10) | Newest first. `period` is computed in `STORE_TIMEZONE`, and the result echoes the UTC `range` used. Giving both `period` and `after`/`before` is rejected. The bounds go to WooCommerce as UTC **without** a zone suffix plus `dates_are_gmt=true`, because WordPress would otherwise shift a `Z` bound into site-local time ([workflows, section 6](../../docs/workflows.md#6-mcp-tool-call-to-the-store)). |
| `get_order` | `order_id` (1-2147483647) | Line items, totals, billing name and email, payment method, dates. |
| `update_order_status` | `order_id` (1-2147483647), `status` (`pending`, `processing`, `on-hold`, `completed`, `cancelled`, `refunded`, `failed`) | A write. |
| `ping` | none | Returns `ok` and the server time. Does not call WooCommerce. |

Tool names match `^[a-z_]{1,40}$` because the gateway will later prefix them with `woo__`. Descriptions are kept short on purpose; every description is sent to the LLM.

### Token budget (Phase 4)

The Phase 4 agent runs on Groq's free tier (8K tokens per minute), and the whole tool list is sent with every model call. So the schemas avoid long regular expressions (format checks run as zod `refine` steps, which the server enforces but the JSON Schema does not carry), every integer has an explicit bound (otherwise zod emits `maximum: 9007199254740991`), the text result is compact JSON, and lists default to 10 items.

Measured on the real `tools/list` response of the deployed server through the SDK client, 2026-10-19 (tokens estimated as characters / 3.5):

| | `tools/list` result | Largest tool (`list_orders`) |
|---|---|---|
| Before the final-review fixes | 3,569 characters, about 1,020 tokens | 1,356 characters |
| **Now: the WooCommerce share of the Phase 4 budget** | **3,004 characters, about 860 tokens** | 837 characters |

A default `list_orders` result (10 orders) is now about 1,670 characters of text, about 480 tokens. If the gateway forwards both `content` and `structuredContent` to the model, results count twice. Each tool schema still carries the SDK's `"$schema"` URL (about 50 characters); the gateway could drop it when it builds its catalogue (not done here).

## Configuration (environment variables)

Read by `src/config.ts`. A missing or invalid variable stops the process at start with a message that lists the variable **names** only, never the values.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `WOO_AUTH_MODE` | no | `oauth1` | `oauth1` (default, today's mode: signed requests to the in-cluster store over HTTP) or `basic` (`Authorization: Basic base64(key:secret)`, for a store hosted elsewhere; see [ADR-019](../../docs/decisions/ADR-019-external-woocommerce-store.md)). Anything else stops the server at start. |
| `WOO_BASE_URL` | yes | none | Where the server connects: `http://wordpress.store.svc.cluster.local` (in the cluster, `oauth1`) or `https://shop.example.com` (`basic`). Must be a URL **without a user name or password** in every mode; in `basic` mode it must start with `https://`. |
| `WOO_SIGNING_BASE_URL` | with `oauth1` | none | The URL the OAuth1 signature is computed over: the public store URL with scheme `http` (for example `http://store.localhost`). Must start with `http://`. In the chart it comes from the helper `urumi.storeSigningBaseUrl`. Optional and ignored with `basic`. |
| `WOO_CONSUMER_KEY` | yes | none | WooCommerce REST consumer key (at least 10 characters). From Secret `store-woo-api`, key `consumer-key`. |
| `WOO_CONSUMER_SECRET` | yes | none | WooCommerce REST consumer secret (at least 10 characters). From Secret `store-woo-api`, key `consumer-secret`. |
| `MCP_AUTH_TOKEN` | yes | none | The bearer token clients must send (at least 16 characters). From Secret `mcp-woocommerce-token`, key `token`. |
| `PORT` | no | `3001` | HTTP port. |
| `STORE_TIMEZONE` | no | `UTC` | IANA time zone used to compute `today`, `yesterday` and `last_7_days`. The chart passes `storeSetup.timezone` (`Asia/Kolkata` locally). An invalid zone is rejected at start. |
| `WOO_TIMEOUT_MS` | no | `10000` | Per-request timeout for WooCommerce calls (1000-60000). |
| `LOG_LEVEL` | no | `info` | pino log level. |
| `MCP_ALLOWED_HOSTS` | no | `localhost,127.0.0.1` | Comma-separated **hostnames, without ports**, accepted in the `Host` header of `/mcp` requests (DNS-rebinding defence in depth). The SDK compares hostnames only, so a port in an entry is stripped, and entries are lowercased (the SDK compares the lowercase hostname). A list with no usable entry stops the server at start. The chart sets the Service names (`mcp-woocommerce`, `mcp-woocommerce.mcp`, `.mcp.svc`, `.mcp.svc.cluster.local`) plus `localhost` and `127.0.0.1`. Anything else gets `403`. `/healthz` and `/readyz` are never host-checked. |

The server never calls WooCommerce at startup or in `/readyz`, so a fresh install does not deadlock while the store is still being set up.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /mcp` | Host check, then `Authorization: Bearer <MCP_AUTH_TOKEN>` | MCP JSON-RPC (stateless Streamable HTTP, spec 2026-07-28, 2025-era clients also served). `GET`/`DELETE` return 405. |
| `GET /healthz` | none | Liveness. |
| `GET /readyz` | none | Readiness. Checks only the process, never WooCommerce. |

## Run it locally (outside Kubernetes)

Not needed for normal use, because `scripts\up.ps1` builds and deploys the image. This is for development. The steps below were not run end to end on the reference machine as written (**not tested**); the build and test commands are.

```powershell
npm ci                                       # once, from the repository root
npm run build -w @urumi/shared               # the server imports the built shared package
npm run build -w @urumi/mcp-woocommerce
```

Point it at the store in the cluster through a port-forward (leave this running in a second terminal):

```powershell
kubectl -n store port-forward svc/wordpress 18080:80
```

Then set the variables in your PowerShell session and start it. Fetch the key and secret with `scripts\get-secret.ps1` (it copies to the clipboard; use `-Show` only in a private terminal), and paste them into the two secret variables. Do not put real secrets in files that are committed.

```powershell
$env:WOO_BASE_URL         = 'http://127.0.0.1:18080'
$env:WOO_SIGNING_BASE_URL = 'http://store.localhost'
$env:WOO_CONSUMER_KEY     = '<paste consumer-key>'
$env:WOO_CONSUMER_SECRET  = '<paste consumer-secret>'
$env:MCP_AUTH_TOKEN       = '<any string of 16 or more characters>'
$env:STORE_TIMEZONE       = 'Asia/Kolkata'
npm start -w @urumi/mcp-woocommerce          # listens on http://127.0.0.1:3001/mcp
```

## Tests and checks

From the repository root:

```powershell
npm test               # all workspaces (2026-10-19: 33 shared + 77 mcp-woocommerce tests)
npm run typecheck
npm run lint
```

What the tests cover: the OAuth1 signer against a known-answer vector produced by an independent PHP implementation, the WooCommerce client (error mapping, timeouts, redirects, credential redaction, error-code sanitising), `resolvePeriod` (including the `Asia/Kolkata` boundaries), every tool with a fake `WooApi` (including date bounds sent without `Z` or an offset, and string or number prices), config validation, and the whole server over HTTP with the real SDK client (bearer auth, Host check, probes, schema size: no `pattern`, no 2^53-1 bounds).

End-to-end check against the running cluster (real WooCommerce): `scripts\check-mcp-woocommerce.ps1` (read-only) or with `-Write` (creates a **draft** product and re-saves an order's status). See the run guide.

## OAuth 1.0a notes (read before changing `src/woo/`)

Decision record: [ADR-005](../../docs/decisions/ADR-005-woocommerce-rest-oauth1.md).

- **Why OAuth1:** in-cluster traffic is plain HTTP, and WooCommerce only accepts Basic auth with the consumer key over HTTPS. Signing uses `HMAC-SHA256`; the HMAC key is `<consumer secret>&`; the OAuth parameters go in the query string.
- **Sign one URL, send to another.** WooCommerce rebuilds the signature base from its own `get_home_url()`, not from the request. So `WooClient` connects to `WOO_BASE_URL` (the in-cluster Service) but signs `WOO_SIGNING_BASE_URL` plus the path. Signing the URL you actually requested gives `401 Invalid signature`. The signing base is the public store URL with the scheme forced to `http`; the port is included only if the public URL has a non-default port. Verified in the cluster: signed GET, POST and PUT through `wordpress.store.svc.cluster.local` all succeed.
- **Pretty permalinks are required.** The signer assumes the REST route is `/wp-json/wc/v3/...`. The store setup Job turns pretty permalinks on; if someone switches them off, the REST path changes and every call fails.
- **Only scalar, unique query keys.** PHP rewrites `.` and spaces in keys and parses `a[]=` as arrays, so such keys would be signed differently by WooCommerce. The signer throws `OAuth1Error` for them. Send lists comma-separated (`include=1,2`). Caller-supplied `oauth_*` keys are rejected too.
- **The timestamp window is plus or minus 15 minutes.** If the clock of the machine running Docker drifts (typical after the laptop sleeps), WooCommerce answers `401`, which looks like a signature problem. Fix: restart Docker Desktop or run `wsl --shutdown`.
- **A fresh nonce for every request, and no retries.** WooCommerce stores used nonces, so replaying a request fails. `create_product` is also not idempotent, so a retry could create a duplicate. The server therefore never retries; one timeout (`WOO_TIMEOUT_MS`) applies per request, and the model or user decides whether to try again.
- **Redirects are not followed.** A `3xx` (for example a wrong URL scheme being redirected) becomes a clear tool error instead of a silent re-request with a stale signature.
- **Errors never contain credentials.** WooCommerce error text is scrubbed of `oauth_*` parameters and of the configured key and secret before it reaches a tool result or a log line. The error `code` from WooCommerce's JSON is scrubbed the same way, then limited to `[a-z0-9_]` and 64 characters.

## Layout

```text
src/main.ts             process entry: load config, start server, handle SIGTERM
src/config.ts           env schema (zod) and validation
src/server.ts           wires WooClient + tools into packages/shared startMcpHttpServer
src/tools/              one file per tool, index.ts registers them, format.ts shapes results
src/woo/                oauth1.ts (signer), client.ts (WooApi), errors.ts, period.ts
test/                   vitest tests
```

Shared HTTP/MCP plumbing (logger, env loader, bearer middleware, the stateless server bootstrap) lives in `packages/shared`. The container image is built from `docker/node-app.Dockerfile` by `scripts\build-images.ps1`.
