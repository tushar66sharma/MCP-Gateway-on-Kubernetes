# System design and tradeoffs

A short note. Long versions: [architecture.md](architecture.md), [system-design.md](system-design.md), [error-handling.md](error-handling.md), [deployment.md](deployment.md). Every statement is checked in the code or in a dated run on the local k3d cluster, or labelled **expected** or **not tested**.

## 1. Architecture choices

| Choice | Why, in one line | Where |
|---|---|---|
| **One Helm chart, one release, three namespaces** (`store`, `mcp`, `gateway`) | Local and production differ only by values files; namespaces are the unit for Pod Security and NetworkPolicies. | `charts/urumi-platform`, [ADR-003](decisions/ADR-003-single-helm-chart-three-namespaces.md) |
| **Our own MCP servers** (WooCommerce 6 tools, Notes 5, Utilities 4) | The assignment requires the WooCommerce server; the other two are small and give real name collisions (`ping` exists three times). The WooCommerce server signs REST calls with OAuth 1.0a, which WooCommerce supports over plain http inside the cluster. | `apps/mcp-*`, [ADR-005](decisions/ADR-005-woocommerce-rest-oauth1.md) |
| **The gateway is an MCP client and an MCP server** | Clients see one endpoint (`/mcp`); the gateway holds the only copy of each upstream credential. The two credentials never meet. | `apps/gateway/src/mcp`, `src/upstreams` |
| **A cached tool catalog** | `tools/list` reads memory, so a dead upstream never slows or breaks listing; it can be stale for about 20 s. | [ADR-014](decisions/ADR-014-cached-tool-catalog.md) |
| **Stateless Streamable HTTP** | A new MCP server object per request, no session id, no affinity. Revocation is immediate because there is no auth cache (one indexed read per request). | [ADR-007](decisions/ADR-007-mcp-sdk-version.md), [ADR-008](decisions/ADR-008-api-key-hashing.md), [system-design.md §3](system-design.md#the-mcp-endpoint-post-mcp) |
| **Postgres for gateway state** | Users, hashed keys, the server registry (credentials encrypted), the audit log and the chat budget need a transactional store. One StatefulSet with a PVC. | `apps/gateway/src/db/schema.ts`, [system-design.md §2](system-design.md#2-data-model) |
| **nginx serves the dashboard** | A separate non-root pod with a strict CSP; the browser sees one origin for `/`, `/api` and `/mcp`. | [ADR-015](decisions/ADR-015-dashboard-served-by-nginx.md) |
| **The chat agent calls the gateway's own `/mcp`** | One auth, routing and audit path for every client; calls run as the logged-in user. Groq (and OpenRouter) go through one OpenAI-compatible adapter. | [ADR-010](decisions/ADR-010-chat-agent-loopback.md), [ADR-011](decisions/ADR-011-llm-provider-abstraction.md) |

Only Traefik is reachable from outside. The three MCP servers and both databases have `ClusterIP` Services and no Ingress; 16 NetworkPolicies (default deny per namespace plus the allow matrix in [security.md §15](security.md#15-networkpolicies-phase-5)) enforce it.

## 2. Tool aggregation, routing and failure handling

- **Naming.** A gateway tool is `<slug>__<upstream tool>` (`woo__list_orders`). The slug is chosen by the admin, unique, immutable and cannot contain `_`, so the gateway splits on the first `__`. Two servers with the same tool name therefore coexist (`woo__ping`, `notes__ping`, `utils__ping`). A tool whose prefixed name does not match `^[a-zA-Z0-9_-]{1,64}$` is skipped alone and shown as skipped on the server page. The description gets a `[Server name] ` prefix. ([ADR-006](decisions/ADR-006-tool-naming-scheme.md))
- **The catalog.** Every 15 s (`UPSTREAM_HEALTH_INTERVAL_MS`) each enabled server gets a check: the SSRF check again, connect if needed, `tools/list` with a 5 s timeout (`UPSTREAM_HEALTH_TIMEOUT_MS`). Success replaces its cached tools; failure drops its client and tools and records a readable `lastError`. `tools/list` returns the cached tools of servers that are enabled **and** connected.
- **Routing a call.** Authenticate; split the name; find the server by slug; if it is disabled or not connected answer `isError` "Server '<slug>' is disabled or unreachable" (audited `denied`); otherwise call the upstream with its own credential and a 20 s deadline (`UPSTREAM_CALL_TIMEOUT_MS`, which must stay above the WooCommerce server's own 10 s). **Calls are never retried** (`create_product` is not idempotent). An audit row (user, server, tool, start, duration, outcome) is written for every call. ([system-design.md §6](system-design.md#6-toolscall-routing))
- **A dead upstream.** A connection error or HTTP 401, 403, 404 or 5xx during a call marks the server `unreachable` at once, without waiting for the tick. A timeout or an error the upstream answered fails only that call. Health states: `connected`, `unreachable`, `disabled`, `unknown` ([state diagram](system-design.md#4-the-upstream-manager)).
- **Measured.** Killing the `utils` pod on 2026-10-23: `unreachable` after 3.7 s, `woo__list_products` kept answering, `connected` again 19.9 s after the kill; the dead server's call returned the clear `isError` above ([demo-script.md](demo-script.md#kill-the-pod-of-one-upstream-server)).

## 3. What changes for production

The same chart installs on one k3s server with [`deploy/values-prod.yaml`](../deploy/values-prod.yaml) instead of [`deploy/values-local.yaml`](../deploy/values-local.yaml). Nothing in `charts/` changes.

| Concern | Local (k3d) | Production (k3s on a VPS) |
|---|---|---|
| **DNS** | `store.localhost`, `app.localhost` resolve to 127.0.0.1 on their own | Two A records (`store.<domain>`, `app.<domain>`) to the server; `global.storeHost`, `global.appHost` |
| **Ingress and TLS** | Traefik, plain http on port 80 | Same Traefik; `global.tls.enabled: true`, `publicScheme: https`, `publicPort: 443`, cert-manager `ClusterIssuer` `letsencrypt-prod`; the chart adds the cert-manager annotation and TLS blocks on the Ingresses (cert-manager issues the Certificates), an http-to-https redirect and HSTS; `COOKIE_SECURE` follows. Traefik's Service gets `externalTrafficPolicy: Local` (`deploy/prod/traefik-config.yaml`) so rate limits see real client addresses |
| **Storage class** | `global.storageClass: ""`, k3s `local-path`, 2 Gi volumes (Postgres 1 Gi) | Same default class on k3s (`local-path`, so volumes live on that one node's disk); larger volumes (MariaDB and WordPress 10 Gi, Postgres 5 Gi); set `global.storageClass` to use another class |
| **Secrets** | The chart generates them once and keeps them | Pre-created with `scripts/prod/create-prod-secrets.sh`, named under `secrets.existing.*`; values on stdin only, never in a file or in Git |
| **Images** | Built locally and imported into k3d | `ghcr.io/<owner>/urumi/<app>:<tag>` (`global.imageRegistry`, `global.imageTag`), built multi-arch for amd64 and arm64 |
| **Sizing** | Small defaults | Requests and limits sized for 2 OCPU / 12 GB |
| **Store** | Customer registration on | `storeSetup.customerRegistration: false`; scheduled work runs as the `wp-cron` CronJob in both ([ADR-018](decisions/ADR-018-wordpress-cron-via-cronjob.md)) |

**Status:** these values were validated with `helm lint` and `kubeconform` and **rehearsed on a second local k3d cluster** with a self-signed issuer on 2026-10-23 (pods ready under Pod Security `restricted`, certificates `Ready`, `301` redirect, HSTS, `Secure` cookie, 13 of 13 NetworkPolicy probes; [deployment.md](deployment.md#rehearsal-results-2026-10-23)). They have **not been deployed on a real VPS**: no real domain, no Let's Encrypt certificate, no GHCR push, no arm64 image, no real client IP. Upgrade is `helm upgrade`; rollback is `helm rollback`, which does not undo database changes, so back up first ([deployment.md §11-12](deployment.md#11-upgrade-and-roll-back)).

## 4. Main trade-offs

- **API keys hashed with SHA-256, upstream credentials encrypted with AES-256-GCM:** a key can be hashed because it is random; an upstream credential must be sent, so it must be recoverable. Losing `GATEWAY_ENCRYPTION_KEY` loses them; rotation is not built ([ADR-009](decisions/ADR-009-upstream-credential-encryption.md)).
- **One shared credential per upstream:** simple, but every user acts as the same upstream identity; who did what exists only in the gateway audit log ([threat-model.md](threat-model.md)).
- **One gateway replica with `Recreate`:** catalog, health and limiter state are in memory; a rollout costs a few seconds of downtime. Scale-out is not built ([system-design.md §8](system-design.md#8-trade-offs-and-limits)).
- **Default-deny NetworkPolicies and Pod Security `restricted`:** strong containment, but a new pod is open for 3 to 6 s until kube-router programs it, and the internet rule allows any public host on 80 and 443 ([ADR-016](decisions/ADR-016-default-deny-network-policies.md), [ADR-017](decisions/ADR-017-pod-security-restricted.md)).
- **Chat history stays in the browser:** nothing to protect server-side, but the history is client-supplied, which is why the topic check can be talked past ([ADR-020](decisions/ADR-020-chat-guardrails.md)).
- **Single k3s node:** no high availability and storage tied to one disk ([ADR-012](decisions/ADR-012-deployment-target-k3s-vps.md)).
