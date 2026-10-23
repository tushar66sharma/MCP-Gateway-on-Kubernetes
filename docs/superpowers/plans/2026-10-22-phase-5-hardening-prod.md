# Phase 5 — Hardening + Production Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Harden the running platform: NetworkPolicies, Pod Security Admission, abuse limits on the gateway, a migration lock, chat and store-setup hardening, and a LAN-closed local cluster.
- Complete the production values and the k3s VPS guide.
- Prove the production values by installing them into a second, temporary k3d cluster.
- Finish with a verified definition-of-done run.

**Architecture:** No new services. The chart gains:
- default-deny NetworkPolicies with explicit allow rules, toggled by `networkPolicies.enabled`;
- `restricted` Pod Security Admission labels on the three namespaces;
- an HTTPS redirect and HSTS Traefik Middleware, rendered only when `global.tls.enabled`;
- a `storeSetup.customerRegistration` toggle.

The gateway gains two things. One is a per-IP limit on *audited* `/mcp` authentication failures (valid keys are never blocked). The other is a bounded memory for its limiters. Migrations run under a Postgres advisory lock, and the chat route parses its 512 KB body only after the session check.

Production stays "k3s on one VPS" (ADR-012). Nothing is deployed to a real VPS: the prod values are linted, rendered, schema-checked with kubeconform, and then **installed into a throwaway second k3d cluster** with a self-signed cert-manager issuer.

**Tech Stack:** As Phase 4, plus:
- cert-manager **v1.21.2**, via its static manifest from the GitHub release;
- `ghcr.io/yannh/kubeconform:v0.8.0`;
- `curlimages/curl:8.22.0` for the NetworkPolicy probes. 8.23.0 is only 2 days old, so the previous release is pinned.

The packaged Traefik is **3.6.13** (k3s v1.35.5+k3s1, verified on the cluster); Middleware CRDs are `traefik.io/v1alpha1`.

**Spec:** [`docs/superpowers/specs/2026-10-18-mcp-gateway-design.md`](../specs/2026-10-18-mcp-gateway-design.md): §6.7 rate limits, §8 Kubernetes (§8.4 Secrets, §8.5 pod security, §8.6 NetworkPolicies, §8.7 ingress/TLS), §9 security, §11 verification.
- **Master plan:** [`2026-10-18-mcp-gateway-implementation-plan.md`](2026-10-18-mcp-gateway-implementation-plan.md). Its Phase 5 tasks and the **"Carry-forward issues → Phase 5"** checklist are binding; every box there is resolved by a task below or explicitly deferred with a reason.
- **ADRs:** ADR-003 (one chart, three namespaces), ADR-004 (own DB templates, non-root), ADR-012 (k3s VPS, render-validated).

**Decisions made with the owner (2026-10-22):**
1. **Recreate the local cluster with ports bound to `127.0.0.1`.** Accepted: all local data is lost once. The recreation doubles as the fresh-install proof for all Phase 5 hardening.
2. **Validate production values by render + a second k3d cluster.** The local cluster is stopped while it runs, then the second cluster is deleted.
3. **No CI workflow.** All checks stay local.

**Pre-flight research (2026-10-22, from official sources):**
- **Oracle Cloud Always Free (OCI docs):**
  - Ampere A1 (arm64): **1,500 OCPU-hours and 9,000 GB-hours a month = 2 OCPUs and 12 GB of memory** (no longer 4 OCPUs / 24 GB).
  - AMD micro instances: 1 GB each, too small for this stack.
  - Storage and traffic: 200 GB of block storage in total; 10 TB of outbound traffic a month.
  - **Idle reclamation:** an instance can be reclaimed when, over 7 days, the 95th-percentile CPU, network and (A1 only) memory are all below 20 %.
  - **Consequence: our images must be built multi-arch (`linux/amd64,linux/arm64`)** for an A1 VM. Card verification is required and capacity is not guaranteed (ADR-012).
- **k3s networking docs:** customise the packaged Traefik with a `HelmChartConfig` in `/var/lib/rancher/k3s/server/manifests`. To preserve client source IPs with `externalTrafficPolicy: Local`, do **not** set `node-external-ip`.
- **Local client IPs:** locally, every request passes through the k3d `serverlb` proxy container (`k3d-proxy:5.9.0`, 172.19.0.2), so the gateway can never see a real client IP. That is acceptable once the ports are loopback-only.
- **NetworkPolicy enforcement:** k3s v1.35 enforces NetworkPolicy with its embedded kube-router controller; it was not disabled on this cluster (checked the server's process arguments).

## Global Constraints

- **Git:**
  - Branch `phase-5-hardening-prod`, created from `main` at `bfca489`.
  - Several commits per task, with conventional prefixes.
  - **Never push. No `Co-Authored-By` or any Claude/AI attribution.**
- **Root path:** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes` (it has spaces, so quote it).
- **Line endings:** LF, except `*.ps1` (CRLF). `*.sh` files must be LF (they run in Linux containers or Git Bash).
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, ESM `NodeNext` with `.js` extensions in the gateway. No `any` without an eslint-disable line and a reason.
- **Pinned versions:** exact (`npm install -E`); container images pinned to the exact tags in the Tech Stack line. Existing pins stay unchanged.
- **No secrets anywhere visible:** never print, log, commit or screenshot passwords, API keys, LLM keys, tokens, invite links or Secret values. Scripts print the *command* that fetches a secret, never the secret. Never read `.env`. Generated production secrets are written only into Kubernetes Secrets.
- **Every chart change:**
  - must keep `helm lint charts/urumi-platform -f deploy/values-local.yaml` and `-f deploy/values-prod.yaml` green;
  - must be redeployed with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy` and leave **all pods 1/1**;
  - must leave `scripts\check-gateway.ps1 -Write`, `scripts\check-dashboard.ps1` and `scripts\check-mcp-woocommerce.ps1` passing.
- **NetworkPolicy behaviour:** "blocked" means **no HTTP response** (connection refused or timeout), asserted with `curl -m 5` exit codes 7 or 28. DNS egress is allowed on UDP and TCP 53 to pods labelled `k8s-app=kube-dns` in namespace `kube-system`. Namespaces are selected by `kubernetes.io/metadata.name`; Traefik by `app.kubernetes.io/name=traefik` (labels verified on the cluster).
- **Private ranges never reachable through "internet" egress rules:** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `127.0.0.0/8`. In-cluster destinations are allowed only by explicit pod/namespace selectors.
- **Pod Security Admission:** namespaces `store`, `mcp` and `gateway` carry `pod-security.kubernetes.io/enforce: restricted` plus `warn` and `audit` at `restricted`, all with `-version: latest`. Every pod we create, including probe pods from scripts, must comply.
- **Docs:**
  - State only what was verified, with the date; label the rest "expected" or "not tested".
  - Each task updates the docs it affects in the same task: `docs/run-guide.md`, `security.md`, `deployment.md`, `troubleshooting.md`, `testing.md`, `architecture.md`, `system-design.md`, `workflows.md` and its Mermaid diagrams, plus ADRs.
  - In the master plan, tick each carry-forward box when it is resolved, saying how.
- **Verification commands:**
  - `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `helm lint` (both values files);
  - scripts are run as `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\<x>.ps1`.
- **Live cluster facts** (must stay true unless a task changes them on purpose):
  - Release `urumi` lives in namespace `urumi-system`; the app namespaces are `store`, `mcp` and `gateway`; the kube context is `k3d-urumi`.
  - Local URLs: `http://store.localhost`, `http://app.localhost`.

## Review Focus

These five inputs or conditions are not exercised by the spec's examples and are the most likely to hurt a user. Each one is pinned by a test or a live check in the task named.

1. **A default-deny policy silently breaks something the policies forgot.** Examples: kubelet probes, DNS, store-setup's WooCommerce download, wp-admin's outbound update checks hanging page loads, `kubectl port-forward` used by `check-mcp-woocommerce.ps1`. Expected: every pod stays 1/1, every check script passes, and wp-admin pages load in under 5 s. Checks: Task 5.3 Step "live verification" and the probe script.
2. **Many clients share one source IP** (every local request comes through the k3d proxy; on a VPS, ServiceLB may SNAT). Expected: one misbehaving client sending garbage `ugw_` keys can never lock out a valid key from the same IP; only *audited* failures are limited. Test: Task 5.1 `a valid key passes while its IP is over the failure limit`.
3. **A fresh install under `restricted` Pod Security**, including first-boot paths that only run once (the WordPress copy initContainer, the store-setup Job, MariaDB first init with `MARIADB_ROOT_HOST`, and the probe pods). Expected: all pods are admitted and become ready on a brand-new cluster. Check: Task 5.8's cluster recreation from zero.
4. **A hostname value that breaks out of PHP.** `storeHost`/`appHost` are inserted into the `WORDPRESS_CONFIG_EXTRA` PHP that WordPress `eval`s, so a value like `x');evil('` would inject code. Expected: the schema rejects any value that is not a DNS hostname. Test: Task 5.4 `helm lint` with `storeHost: "x');evil('"` fails.
5. **Two gateway replicas, or an overlapping rollout, migrating at once.** Expected: migrations are serialised by a Postgres advisory lock, and the lock is released even when a migration throws. Test: Task 5.1 `runs migrations inside the advisory lock and unlocks on failure`.

---

### Task 5.1: Gateway abuse limits and the migration lock

**Files:**
- Modify: `apps/gateway/src/auth/rateLimit.ts` (generalise to `FixedWindowLimiter`, key cap, `check`)
- Modify: `apps/gateway/src/mcp/auth.ts` (failure limit), `apps/gateway/src/api/auth.routes.ts`, `apps/gateway/src/server.ts`, `apps/gateway/src/main.ts`
- Modify: `apps/gateway/src/config.ts` (`MCP_AUTH_FAILURE_LIMIT_PER_MIN`)
- Modify: `apps/gateway/src/db/migrate.ts`, `apps/gateway/src/db/client.ts` (advisory lock)
- Modify: `charts/urumi-platform/values.yaml`, `values.schema.json`, `templates/gateway/gateway.yaml` (`gateway.mcpAuthFailureLimitPerMin` → env)
- Test: `apps/gateway/test/auth/rateLimit.test.ts`, `apps/gateway/test/mcp/auth.test.ts` (or the existing `/mcp` auth suite), `apps/gateway/test/db/migrate.test.ts`, `apps/gateway/test/config.test.ts`
- Docs: `apps/gateway/README.md` (variable table, known limits), `docs/security.md` (§8 residual risks: `/mcp` rate limit is now built), `docs/error-handling.md` (new 429 on `/mcp`), `docs/system-design.md`

**Interfaces:**
- Produces:
```ts
// rateLimit.ts — replaces LoginRateLimiter (update every import; no alias left behind)
export class FixedWindowLimiter {
  constructor(o: { max: number; windowMs: number; clock: () => Date; maxKeys?: number }); // maxKeys default 10_000
  hit(key: string): { allowed: boolean; retryAfterSec: number };   // counts, as LoginRateLimiter.hit did
  check(key: string): { allowed: boolean; retryAfterSec: number }; // does not count
  readonly size: number;                                             // live keys, for tests
}
// db/migrate.ts
export const MIGRATION_LOCK_KEY = 7314420001n;  // fixed bigint, documented in the code comment
export async function withMigrationLock<T>(client: { query(sql: string, params?: unknown[]): Promise<unknown> }, run: () => Promise<T>): Promise<T>;
// GatewayDeps gains: mcpAuthLimiter: FixedWindowLimiter  (rateLimiter becomes FixedWindowLimiter)
```
- **Behaviour of the `/mcp` limit:**
  - **Key:** `req.ip`.
  - **When the limit applies:** only to *recognised* rejections, the ones that are audited today. A valid credential is always accepted, even while its IP is over the limit, and does not count.
  - **Over the limit:** the client gets `429` with `Retry-After` and the JSON-RPC body `{"jsonrpc":"2.0","error":{"code":-32029,"message":"Too many failed authentication attempts"},"id":null}`. **No audit row** is written. One `warn` log line `mcp auth failures limited` is written per IP per window, with no credential in it.
  - **Unrecognised garbage** keeps today's behaviour: `401`, no audit row, no count.
- **Limits and memory:**
  - Default `MCP_AUTH_FAILURE_LIMIT_PER_MIN` is 30 (range 1–1000).
  - The login limiter stays 10 per minute per `ip|email`, now with `maxKeys` 10,000.
  - When a new key arrives at the cap, after sweeping expired windows, the **oldest inserted** key is evicted. Map insertion order.

- [ ] **Step 1: Write the failing tests**
  - `rateLimit.test.ts`:
    - `check does not count`
    - `evicts the oldest key at maxKeys`: maxKeys 3; keys a, b, c, d → `size === 3` and `a` is fresh again.
    - `sweeps expired windows before evicting`
    - The existing login cases, moved over from `LoginRateLimiter`.
  - `/mcp` auth:
    - `recognised failures over the limit answer 429 with Retry-After and write no audit row`: max 2; three requests with a revoked key → 401, 401, 429; audit rows === 2.
    - `a valid key passes while its IP is over the failure limit`
    - `unrecognised credentials are not counted`: 50 `Bearer garbage` → all 401; a revoked key afterwards → 401, not 429.
    - `the limit window resets`: fake clock +60 s.
  - `migrate.test.ts`:
    - `runs migrations inside the advisory lock and unlocks on failure`: a fake client records the queries. Expected order: `select pg_advisory_lock($1)` with `[MIGRATION_LOCK_KEY]`, then `run`, then `select pg_advisory_unlock($1)`. When `run` throws, the unlock is still sent and the error is rethrown.
  - `config.test.ts`: `MCP_AUTH_FAILURE_LIMIT_PER_MIN` defaults to 30 and rejects 0 and 1001.
- [ ] **Step 2:** Run `npm test -w @urumi/gateway`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - In `client.ts`, `migrate()` takes one client from the migration pool (`pool.connect()`) and calls `withMigrationLock(client, () => migratePg(drizzle(client, { schema }), …))`, then releases the client.
  - `trust proxy` is already set on the shared Express app (`server.ts`), so `req.ip` is valid inside the `/mcp` auth middleware. Add a test assertion that `X-Forwarded-For` is honoured with `TRUST_PROXY=1`.
  - In the chart: add `gateway.mcpAuthFailureLimitPerMin: 30` (schema: integer 1–1000) and the env var.
- [ ] **Step 4:** Run `npm test -w @urumi/gateway`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Live check.**
  1. `up.ps1 -Redeploy`; all pods 1/1.
  2. `check-gateway.ps1 -Write` passes.
  3. 31 requests with a well-formed **unknown** `ugw_` key (a made-up value, never a real key) → 30 × 401 then 429.
  4. Then the real check key still works.
  5. Record the counts in `docs/security.md`.
- [ ] **Step 6: Commit.**
  - `feat(gateway): limit audited /mcp auth failures per IP and cap limiter memory`
  - `feat(gateway): serialise migrations with a Postgres advisory lock`
  - `docs: gateway abuse limits and migration lock`

### Task 5.2: Chat route hardening (Phase 4 deferred items #2, #3, #4, #7, #8, #9)

**Files:**
- Modify: `apps/gateway/src/api/router.ts`, `apps/gateway/src/api/chat.routes.ts`, `apps/gateway/src/chat/service.ts`, `apps/gateway/src/chat/mcpLoopback.ts`, `apps/gateway/src/chat/agent.ts` (neutralisation)
- Test: `apps/gateway/test/chat/*.test.ts`, `apps/gateway/test/api/chat.routes.test.ts`
- Docs: `docs/ai-integration.md`, `docs/error-handling.md`, `apps/gateway/README.md` (known limits), `docs/security.md` §12

**Interfaces:**
- `connectLoopback(mcpUrl: string, mintToken: () => string, signal?: AbortSignal)`: an aborted signal rejects the connect at once, and an abort during connect closes the transport.
- `stoppedReason` gains `'client_closed'`, which is logged instead of `'timeout'` when the browser disconnected.

- [ ] **Step 1: Write the failing tests.**
  - **#8:** `the 512 KB chat parser runs after the session check`:
    - an **unauthenticated** `POST /api/chat` with a 300 KB body → `401 UNAUTHENTICATED`;
    - the router's JSON parser is not invoked for `/chat` before `requireSession`. Assert via a spy, or by sending invalid JSON unauthenticated and getting `401` rather than `400`;
    - `POST /api/keys` with 150 KB → `413`;
    - an authenticated 300 KB chat body is accepted by the parser (`400 VALIDATION_FAILED` on bounds, not 413);
    - the mixed-case path `/api/CHAT` behaves the same way.
  - **#2:** `a request whose socket is already closed when the handler starts releases the in-flight slot`. The next request from the same user is not `409`.
  - **#3:** `connectLoopback rejects immediately on an aborted signal`.
  - **#4:** `mints a fresh internal token for every HTTP request of a turn`. Count `mintToken` calls ≥ the number of loopback requests in a 2-tool turn, and check that every token is distinct.
  - **#7:** `a client disconnect is logged as client_closed`.
  - **#9:** `neutralises case and whitespace variants of the tool_result tags`. Inputs: `</TOOL_RESULT>`, `</tool_result >`, `< /tool_result>`, `<tool_result\n>`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **#8:** The general `express.json({limit:'100kb'})` skips paths whose lowercase form starts with `/chat`. The chat router applies `requireSession` first and then `express.json({limit:'512kb'})` on `POST /chat`. The CSRF guard stays before both (it reads headers only). Update the router's order comment.
  - **#2:** In the handler, after the session check, return without starting a turn if `req.socket.destroyed || res.closed`. Register the `close` listener before any `await`.
  - **#9:** Use one case-insensitive regex for opening and closing tags, with optional whitespace.
- [ ] **Step 4:** Run `npm test` (root), `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Live check.**
  1. Redeploy.
  2. One chat turn via `check-dashboard.ps1 -Project desktop` passes.
  3. `kubectl -n gateway logs deploy/gateway | Select-String '"msg":"chat turn"'` shows `stoppedReason":"final"`.
- [ ] **Step 6: Commit.**
  - `fix(gateway): parse chat bodies only after the session check`
  - `fix(gateway): release the chat slot on early disconnects and log them as client_closed`
  - `fix(gateway): cancel the loopback connect with the turn and neutralise tag variants`
  - `docs: chat hardening`

### Task 5.3: NetworkPolicies and the probe script

**Files:**
- Create in `charts/urumi-platform/templates/network/`:
  - `default-deny.yaml`: ingress **and** egress, in each of the 3 namespaces;
  - `dns.yaml`: egress to kube-dns, for every pod in the 3 namespaces;
  - `store.yaml`, `mcp.yaml`, `gateway.yaml`.

  Everything is rendered only when `networkPolicies.enabled`.
- Modify: `values.yaml` (`networkPolicies.enabled: true`), `values.schema.json`
- Create: `scripts/test-network-policies.ps1` (CRLF)
- Docs:
  - `docs/security.md`: a new NetworkPolicy section with the allow matrix and a Mermaid map;
  - `docs/diagrams/network-policies.md` (Mermaid plus explanation);
  - `docs/architecture.md`, `docs/run-guide.md` (how to run the probe script), `docs/troubleshooting.md` ("a pod cannot reach X after Phase 5");
  - `docs/decisions/ADR-016-default-deny-network-policies.md`.

**Allow matrix (each row is one policy rule; every other flow is denied):**

| From | To | Port | Why |
|---|---|---|---|
| Traefik (`kube-system`, `app.kubernetes.io/name=traefik`) | wordpress | 80 | public store |
| Traefik | gateway | 3000 | `/api`, `/mcp` |
| Traefik | dashboard | 8080 | `/` |
| wordpress, store-setup | mariadb | 3306 | database |
| mcp-woocommerce | wordpress (namespace `store`) | 80 | WooCommerce REST |
| gateway | mcp-woocommerce, mcp-notes, mcp-utilities (namespace `mcp`) | 3001–3003 | upstream MCP |
| gateway | postgres | 5432 | database |
| gateway | internet (`0.0.0.0/0` except the private ranges) | 443, 80 | LLM providers, admin-added external MCP servers (the SSRF guard still applies) |
| wordpress | internet (except private ranges) | 443, 80 | wp-admin update and marketplace checks; without it wp-admin pages hang on timeouts |
| store-setup | internet (except private ranges) | 443, 80 | WooCommerce download from downloads.wordpress.org |
| all pods in the 3 namespaces | kube-dns | 53 UDP+TCP | DNS |

- **Verify whether mcp-utilities needs egress.** None was found (`grep fetch( apps/mcp-utilities/src`), so it gets DNS only. mcp-notes also gets DNS only.
- **Selectors:** pods by `app.kubernetes.io/name` (the existing selector labels); the store-setup Job by its own pod label; namespaces by `kubernetes.io/metadata.name`.

- [ ] **Step 1: Write `scripts/test-network-policies.ps1` first (the failing test).** Each probe:
  ```
  kubectl run np-<n> -n <ns> --rm -i --restart=Never --image=curlimages/curl:8.22.0 --labels=<labels> --overrides=<restricted securityContext JSON> -- curl -s -o /dev/null -w '%{http_code}' -m 5 <url>
  ```
  - The override sets `runAsNonRoot`, uid 100, seccomp `RuntimeDefault`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]` and `automountServiceAccountToken: false`, so the probes also pass under Task 5.4's `restricted` Pod Security.
  - **Matrix:**

    | From | To | Expected |
    |---|---|---|
    | `default` namespace | mcp-woocommerce | blocked |
    | `default` namespace | postgres | blocked |
    | `default` namespace | mariadb | blocked |
    | pod labelled mcp-notes (in `mcp`) | wordpress | blocked |
    | pod labelled mcp-notes (in `mcp`) | postgres | blocked |
    | pod labelled mcp-notes (in `mcp`) | `https://example.com` | blocked |
    | pod labelled gateway (in `gateway`) | mcp-woocommerce `/mcp` | reachable, 401 |
    | pod labelled gateway (in `gateway`) | `https://api.groq.com` | reachable, any HTTP code |
    | pod labelled gateway (in `gateway`) | mariadb | blocked |
    | pod labelled gateway (in `gateway`) | `http://169.254.169.254` | blocked |
    | pod labelled mcp-woocommerce (in `mcp`) | wordpress `/wp-login.php` | reachable, 200 |
    | pod labelled dashboard (in `gateway`) | gateway | blocked: the dashboard needs no egress |

  - "Blocked" means curl exits 7 or 28 with no HTTP code.
  - Output: a table of from, to, expected and actual. It ends with `NetworkPolicies behave as designed (<n> probes)` or exits 1. A `-Namespace`-style param is not needed.
  - **Run it now:** the "blocked" rows FAIL, because there are no policies yet.
- [ ] **Step 2: Write the templates** from the matrix. Add `networkPolicies.enabled` (default `true`) to the values and schema. Run `helm lint` (both values files) and `helm template` to confirm 3 default-deny policies and the allow rules render, and that nothing renders with `--set networkPolicies.enabled=false`.
- [ ] **Step 3: Live verification.**
  1. `up.ps1 -Redeploy`; **all pods 1/1**, and the probes keep passing for 2 minutes (`kubectl get pods -A` twice, 60 s apart, with no restarts).
  2. The probe script passes.
  3. `check-gateway.ps1 -Write`, `check-dashboard.ps1`, `check-mcp-woocommerce.ps1 -Write` and `check-woo-api.ps1` all pass.
  4. One chat turn succeeds (LLM egress).
  5. **wp-admin:** `Measure-Command` on `GET http://store.localhost/wp-admin/` while logged out (the redirect to login) and on `/wp-login.php` → under 5 s.
  6. `kubectl -n store delete job store-setup`, then `up.ps1 -Redeploy` → the Job reaches `Completed` (proves its egress and DB access).
  7. Record every result with its date in `security.md`.
- [ ] **Step 4: Commit.**
  - `test: add NetworkPolicy probe script`
  - `feat(helm): add default-deny NetworkPolicies with explicit allow rules`
  - `docs: NetworkPolicy map, ADR-016 and troubleshooting`

### Task 5.4: Pod Security Admission, chart schema and pod hardening

**Files:**
- Modify: `templates/namespaces.yaml` (PSA labels from `podSecurity.level`, default `restricted`)
- Modify: `templates/store/wordpress.yaml`:
  - add `define('DISALLOW_FILE_MODS', true);` to `WORDPRESS_CONFIG_EXTRA`;
  - change the liveness probe to `tcpSocket: { port: http }` (readiness and startup stay on `/wp-login.php`).
- Modify: `templates/store/mariadb.yaml` (`MARIADB_ROOT_HOST=localhost`)
- Modify: every pod's `/tmp` emptyDir to `sizeLimit: 16Mi` (in `urumi.simpleMcpServer`, `gateway.yaml`, `dashboard.yaml`, `mcp-woocommerce.yaml`, `wordpress.yaml`). Find each one with `grep -rn emptyDir`.
- Modify: `docker/dashboard.Dockerfile`: set `worker_processes 2;` in the image's main `/etc/nginx/nginx.conf` (a `sed` at build time). Verify it with `docker run --rm urumi/dashboard:<tag> nginx -T | grep worker_processes`.
- Modify: `values.schema.json`:
  - `global.storeHost` and `global.appHost` must match the RFC 1123 hostname pattern `^(?=.{1,253}$)([a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)(\.[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)*$`;
  - `storeSetup.timezone` gets `minLength: 1` and pattern `^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$`;
  - if `global.tls.enabled` is true, then `global.publicScheme` must be `https` (an `if/then`);
  - `podSecurity.level` is an enum of `restricted`, `baseline` and `privileged`.
- Docs:
  - `docs/security.md`: §8.5 pod security, with an "as built" table per workload: uid, read-only root, sizeLimit, PSA level;
  - `docs/decisions/ADR-017-pod-security-restricted.md`;
  - `docs/deployment.md`: `MARIADB_ROOT_HOST` applies only on the first initialisation of an empty data directory, and `DISALLOW_FILE_MODS` means plugins and themes change only through the store-setup Job and the image tag, and the WordPress image tag pins only the **first** core copy into the volume (later core updates are not applied by changing the tag);
  - `docs/troubleshooting.md`: `forbidden: violates PodSecurity`.

- [ ] **Step 1: Write the failing render tests** in a new `scripts/validate-chart.ps1` (CRLF), which Task 5.6 extends. It runs `helm lint` with each case and asserts the outcome:
  - `storeHost: "x');evil('"` → fails;
  - `appHost: "App.Example.com"` → fails;
  - `tls.enabled=true` + `publicScheme=http` → fails;
  - `storeSetup.timezone=""` → fails;
  - both real values files → pass.

  Also run `helm template` and check that each namespace has the three PSA labels and every emptyDir has `sizeLimit`.
  Run it now. Expected: the schema cases FAIL, because the values are still accepted.
- [ ] **Step 2: Implement** the schema rules, the labels and the template changes.
- [ ] **Step 3: Check compliance before enforcing.** Run `kubectl label --dry-run=server --overwrite ns store mcp gateway pod-security.kubernetes.io/enforce=restricted`. Expected: **no warnings**. Fix any pod spec that warns before redeploying.
- [ ] **Step 4: Live verification.**
  1. `up.ps1 -Redeploy`; all pods 1/1.
  2. `kubectl get ns store mcp gateway --show-labels` shows the PSA labels.
  3. A non-compliant pod is refused: `kubectl run psa-test -n mcp --image=curlimages/curl:8.22.0 --restart=Never -- sleep 1` → `forbidden: violates PodSecurity "restricted:latest"`.
  4. The probe script from Task 5.3 still passes.
  5. All the check scripts pass.
  6. `kubectl -n store exec deploy/wordpress -c wordpress -- php -r "require '/var/www/html/wp-config.php'; var_export(DISALLOW_FILE_MODS);"` prints `true`. If loading wp-config that way is impractical, grep `wp-config.php` for the constant instead.
  7. wp-admin → Plugins shows no "Add New" button.
- [ ] **Step 5: Commit.**
  - `feat(helm): enforce restricted Pod Security on the app namespaces`
  - `feat(helm): validate hostnames, timezone and TLS scheme in the values schema`
  - `feat(helm): bound /tmp volumes, nginx workers, WordPress file mods and liveness`
  - `docs: pod security as built and ADR-017`

### Task 5.5: Store setup hardening and the customer-registration toggle

**Files:**
- Modify: `charts/urumi-platform/files/store-setup/setup.sh`, `templates/store/store-setup.yaml`, `values.yaml`, `values.schema.json` (`storeSetup.customerRegistration: true`, a boolean)
- Docs: `docs/run-guide.md` §6 (the registration toggle), `docs/security.md` (the open-registration note now names the toggle), `docs/deployment.md` (Docker Hub anonymous pull limits; fresh installs depend on downloads.wordpress.org), `docs/workflows.md` (the store-setup workflow and its diagram), `docs/troubleshooting.md`

**Behaviour:**
1. `ADMIN_PASSWORD` empty or unset → `fail "ADMIN_PASSWORD is empty"`, before any WP-CLI call.
2. `wp core install` gets the admin password through **stdin**, never as an argument. Use `printf '%s\n' "$ADMIN_PASSWORD" | $WP core install … --prompt=admin_password`.
   - **Verify the WP-CLI 2.12 stdin behaviour first:** run the line in a throwaway `wordpress:cli-2.12.0-php8.3` container against a scratch install, or check the WP-CLI handbook for `--prompt`.
   - If `--prompt` cannot read piped stdin, use `wp core install` without the password, then `wp user update admin --user_pass` with the password read from a file in a `0600` `mktemp` file that is deleted at once. Record which way works in the task report.
3. The DB wait loop keeps the last error output, at most 5 lines, and prints it in the `fail` message. It must contain no password; check the output of a deliberately wrong DB host.
4. After install, reconcile `home` and `siteurl` with `$WP_URL`, updating only when they differ.
5. **WooCommerce is never downgraded:**
   - install when it is absent or **older** than `$WOO_VERSION`, compared with PHP `version_compare` via `$WP eval`;
   - when the installed version is newer, log `WooCommerce <found> is newer than <wanted>; not downgrading`;
   - after any install or upgrade, run `$WP wc update`.
6. **Customer registration:**
   - `CUSTOMER_REGISTRATION=true` (from `storeSetup.customerRegistration`) keeps today's options.
   - `false` sets `woocommerce_enable_myaccount_registration no` and `woocommerce_enable_signup_and_login_from_checkout no`.
   - The comment about the demo setting now names the toggle. There is no CAPTCHA; production disables registration, and that is documented.

- [ ] **Step 1: Write the failing checks.**
  - Add `scripts/dev/test-store-setup.ps1` (CRLF). It runs `setup.sh` fragments in a throwaway `wordpress:cli-2.12.0-php8.3` container (`docker run --rm`, with **no** cluster access) for these cases:
    - an empty `ADMIN_PASSWORD` fails with the message;
    - the version comparison helper: `11.2.1` vs `11.2.1` → equal; `11.3.0` vs `11.2.1` → newer; `10.9.9` → older.
  - Extract the comparison into a sourced function file `files/store-setup/lib.sh` so it can be tested; ship `lib.sh` in the same ConfigMap.
  - Expected: FAIL before the implementation.
- [ ] **Step 2: Implement** behaviours 1–6.
- [ ] **Step 3: Live verification.**
  1. `up.ps1 -Redeploy` → `kubectl -n store logs job/store-setup` ends with `SETUP COMPLETE`, and the log contains no password. Grep it for `admin_password` and for the first 6 characters of the real password, read inside a variable that is never printed.
  2. `ps` inside the Job is not possible after it completes. Instead, assert the script has no `--admin_password=` argument (`grep` on the rendered ConfigMap).
  3. With `--set storeSetup.customerRegistration=false` in a one-off redeploy: My Account shows no Register form, and the checkout shows no "Create an account?" box.
  4. Then redeploy back with the local default (`true`).
  5. `customer-order-smoke.ps1` passes.
- [ ] **Step 4: Commit.**
  - `fix(store): never pass the admin password as an argument and fail on an empty one`
  - `fix(store): never downgrade WooCommerce and run its DB update after upgrades`
  - `feat(store): customer registration toggle`
  - `docs: store setup hardening`

### Task 5.6: Production values, TLS redirect, production scripts and render validation

**Files:**
- Modify: `deploy/values-prod.yaml`. It becomes complete:
  - registry/tag placeholders, real-hostname placeholders, `https`/443, TLS on with `letsencrypt-prod`;
  - every `existingSecret`;
  - `storeSetup.customerRegistration: false`, `networkPolicies.enabled: true`, `podSecurity.level: restricted`;
  - `logLevel` info;
  - resources sized for 12 GB / 2 OCPU, kept within the sum of the limits.

  Every placeholder is `CHANGE-ME`, and `scripts/validate-chart.ps1` warns when one remains.
- Create in `charts/urumi-platform/templates/`:
  - `traefik/redirect-https.yaml`: a Middleware `redirectScheme` to `https`, permanent, in each app namespace;
  - `traefik/hsts.yaml`: a Middleware `headers` with `stsSeconds: 31536000`, `stsIncludeSubdomains: false`;
  - both rendered only when `global.tls.enabled`;
  - and the store and app Ingresses get `traefik.ingress.kubernetes.io/router.middlewares: <ns>-redirect-https@kubernetescrd,<ns>-hsts@kubernetescrd` when TLS is on.
- Create in `deploy/prod/`:
  - `cluster-issuer-letsencrypt.yaml`: an ACME HTTP-01 solver with `ingressClassName: traefik` and an email placeholder;
  - `cluster-issuer-selfsigned.yaml`: for the rehearsal;
  - `traefik-config.yaml`: a `HelmChartConfig` with `service.spec.externalTrafficPolicy: Local`.
- Create: `scripts/prod/create-prod-secrets.sh` (LF, bash; for the VPS and for Git Bash in the rehearsal):
  - creates the namespaces `store`, `mcp` and `gateway` **with Helm ownership metadata**: label `app.kubernetes.io/managed-by=Helm`, annotations `meta.helm.sh/release-name=urumi` and `meta.helm.sh/release-namespace=urumi-system`;
  - creates every Secret the prod values name, with generated values (`openssl rand`; the WooCommerce consumer secret is `cs_` + 40 hex characters, the consumer key `ck_` + 40);
  - creates the cross-namespace copies byte-identical;
  - reads the admin email as an argument and the optional LLM keys with `read -rs` (never echoed);
  - never prints a value; it is idempotent (an existing Secret is kept and reported `kept`);
  - ends by printing the **commands** to read each password.
- Modify:
  - `scripts/deploy.ps1`: refuse any values file other than `values-local.yaml` on context `k3d-urumi` (the reverse guard).
  - `scripts/get-admin-password.ps1`, `scripts/get-db-password.ps1`: add `-Namespace` (default `store`) and `-SecretName` (defaults as today).
  - `scripts/create-secrets.ps1`: add `-SecretName` (default `llm-api-keys`); the `.env` parser strips one pair of surrounding quotes and an inline ` #` or tab-`#` comment. Test the parser with a fixture `.env` under `scripts/dev/fixtures/` that holds fake values only.
  - `templates/NOTES.txt`: when `publicScheme` is `https`, print bash `kubectl … | base64 -d` **commands** instead of PowerShell ones.
- Extend: `scripts/validate-chart.ps1`:
  - `helm template … -f deploy/values-prod.yaml` piped through `docker run --rm -i ghcr.io/yannh/kubeconform:v0.8.0 -strict -summary -ignore-missing-schemas -kubernetes-version 1.35.0`. CRDs (Middleware, cert-manager) are reported as skipped, and that is stated in the docs;
  - the same for the local values;
  - the placeholder warning.
- Docs (`docs/deployment.md`, "Production (k3s VPS)", rewritten from "planned" into a beginner guide):
  - an Oracle Always Free sizing table (from the pre-flight facts, with the date and source URL) and the idle-reclamation note;
  - other VPS options, labelled "not verified";
  - installing k3s (`curl -sfL https://get.k3s.io | sh -`); DNS A records; the Traefik `HelmChartConfig`;
  - installing cert-manager v1.21.2 and the ClusterIssuer;
  - `create-prod-secrets.sh`;
  - building and pushing **multi-arch** images to GHCR (`docker buildx build --platform linux/amd64,linux/arm64 --push`, a GHCR login with a PAT that has `write:packages`, making packages public or adding an imagePullSecret). This is labelled **not executed**, because it publishes to your account;
  - `helm upgrade --install` with the prod values;
  - verification (`curl -I` redirect and HSTS, `kubectl get certificate`); logs; **upgrade and rollback** (`helm history`, `helm rollback urumi <rev>`);
  - **backups**: `mariadb-dump` and `pg_dump` through `kubectl exec`, piped to a local file. These are verified on the local cluster in this task and the commands recorded;
  - the Helm release Secret exposure note, which is Phase 6 in the master plan but cheap to add here as a pointer.

  Also update `README.md` (deployment pointer) and ADR-012 (status: rehearsed on k3d, see Task 5.7).

- [ ] **Step 1: Write the failing tests.**
  - Extend `validate-chart.ps1` with these cases:
    - prod values render a Middleware pair per app namespace and the Ingress annotation;
    - local values render neither;
    - `deploy.ps1 -ValuesFile deploy\values-prod.yaml` on `k3d-urumi` → refused. Test it with `-WhatIf`-style dry logic, or by running it and expecting exit 1 before any helm call.
  - Add the parser fixture test for `create-secrets.ps1` (a `-ParseOnly` switch that prints key **names** and `set`/`empty`).
  - Run them. Expected: FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.**
  - **WordPress behind TLS (carry-forward).** Run `kubectl -n store exec deploy/wordpress -c wordpress -- grep -n "HTTP_X_FORWARDED_PROTO" /var/www/html/wp-config.php`.
    - If the official image's generated config already sets `$_SERVER['HTTPS']='on'` from `X-Forwarded-Proto`, record it, with the line, in `deployment.md`.
    - Only if it is missing, add that handling to `WORDPRESS_CONFIG_EXTRA`, guarded so it is a no-op over plain http.
    - Task 5.7 proves it: no mixed-content `http://` asset URLs in the store's HTML over https.
  - `validate-chart.ps1` passes: kubeconform `Valid` for every built-in kind, CRDs skipped.
  - `helm lint` passes on both values files.
  - The backup commands produce non-empty dumps locally. Write the dumps to the scratch directory and delete them afterwards: they contain data.
  - `bash -n scripts/prod/create-prod-secrets.sh` and `shellcheck` (if available through `docker run koalaman/shellcheck:v0.11.0`) are clean.
- [ ] **Step 4: Commit.**
  - `feat(helm): HTTPS redirect and HSTS middlewares for TLS installs`
  - `feat(helm): complete production values`
  - `feat: production secret bootstrap script and script guards`
  - `test: chart render validation with kubeconform`
  - `docs: k3s VPS deployment guide with backups, upgrade and rollback`

### Task 5.7: Production rehearsal in a second k3d cluster

**Files:**
- Create: `deploy/k3d-prod-test.yaml` (cluster `urumi-prod`, ports `127.0.0.1:8080:80` and `127.0.0.1:8443:443`)
- Create: `deploy/values-prod-test.yaml`:
  - hosts `store.prod.localhost` and `app.prod.localhost`; `publicPort: 8443`;
  - `clusterIssuer: selfsigned`; `imageRegistry: ""` with the local image tag;
  - the smallest resources that still pass.
- Create: `scripts/prod-rehearsal.ps1` (CRLF; switches `-Up`, `-Verify`, `-Down`)
- Docs: `docs/deployment.md` ("Rehearsal results", dated, with exactly what passed), `docs/testing.md`, ADR-012 (revisit note)

**Steps:**
- [ ] **Step 1: Bring it up.**
  1. `k3d cluster stop urumi` (frees RAM; data is kept).
  2. `k3d cluster create --config deploy/k3d-prod-test.yaml`.
  3. Install cert-manager v1.21.2: `kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml`, then wait for its 3 deployments.
  4. Apply `deploy/prod/cluster-issuer-selfsigned.yaml` and `deploy/prod/traefik-config.yaml`.
  5. Run `bash scripts/prod/create-prod-secrets.sh admin@example.com`. Use Git Bash; skip the LLM keys (press Enter at both prompts).
  6. `k3d image import` the five images with the current tag into `urumi-prod`.
  7. `helm upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace -f deploy/values-prod.yaml -f deploy/values-prod-test.yaml --wait --timeout 15m`.
  8. **The kube context must be `k3d-urumi-prod`**; the script asserts it before every kubectl and helm call.
- [ ] **Step 2: Verify.** Each line is a PASS/FAIL row in the script output:
  - all pods 1/1 under `restricted`;
  - `kubectl get certificate -A` shows both `Ready=True`;
  - `curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" http://store.prod.localhost:8080/` → `301` to `https://…`. Note: the redirect URL keeps the external port problem, so record exactly what Traefik returns; a redirect to `:443` instead of `:8443` is an expected artefact of port mapping, and is documented, not "fixed";
  - `curl.exe -k -I https://store.prod.localhost:8443/` → `200` with `Strict-Transport-Security`;
  - `curl.exe -k https://app.prod.localhost:8443/api/auth/me` → `401` JSON;
  - the store's HTML over https references assets with `https://` (no mixed content): `curl.exe -k -s https://store.prod.localhost:8443/ | Select-String 'http://store.prod'` → 0 matches;
  - a login through the API with the bootstrap admin, the password read from the Secret into a variable and never printed → `Set-Cookie` contains `Secure`;
  - `scripts\check-gateway.ps1 -Base https://app.prod.localhost:8443`. If the Node smoke script refuses self-signed TLS, run it with `NODE_EXTRA_CA_CERTS` pointing at the issuer's CA exported to the scratch directory, or record it as not run, with the reason;
  - the NetworkPolicy probe script run against the current context passes;
  - the chat shows "not configured" (no LLM key): `GET /api/chat/status` → `configured:false`.
- [ ] **Step 3: Tear down.**
  1. `k3d cluster delete urumi-prod`.
  2. `k3d cluster start urumi`; `kubectl config use-context k3d-urumi`; `up.ps1` → all pods 1/1.
- [ ] **Step 4: Fix** every failure found, with one `fix:` commit each, using superpowers:systematic-debugging, and re-run Step 2.
- [ ] **Step 5: Commit.**
  - `test: production rehearsal on a second k3d cluster`
  - `docs: production rehearsal results`

### Task 5.8: Loopback-only local cluster, fresh install, smoke-test entry point and the definition-of-done run

**Files:**
- Modify: `deploy/k3d-config.yaml` (ports `127.0.0.1:80:80` and `127.0.0.1:443:443`)
- Create: `scripts/smoke-test.ps1` (CRLF). It runs these in order and ends with a summary table and exit code:
  1. pods ready;
  2. `check-woo-api`;
  3. `check-mcp-woocommerce`;
  4. `check-gateway -Write`;
  5. `check-dashboard`;
  6. `test-network-policies`;
  7. the invite-log check: request `/invite/<random>` and grep the dashboard log for the random value → 0 matches;
  8. `npm audit --omit=dev --audit-level=high`.

  `-Quick` skips 5 and 8.
- Modify: `scripts/check-dashboard.ps1`: add the invite-log grep step (the Phase 4 open item).
- Create: `docs/demo-script.md`. Every definition-of-done bullet is a numbered step with its exact command or click and the expected result.
- Docs:
  - `docs/run-guide.md`: the cluster is loopback-only; the new scripts; data lost by the recreation; new passwords;
  - `docs/security.md`: residual risks updated; the LAN exposure is closed;
  - `docs/testing.md`: counts and new scripts;
  - `docs/troubleshooting.md`;
  - `README.md`: status and links;
  - master plan: carry-forward boxes ticked.

**Steps:**
- [ ] **Step 1: Recreate the cluster.**
  1. Record the commit; the working tree must be clean.
  2. Run `scripts\cluster-down.ps1`, then `scripts\up.ps1`. This is a truly fresh install: new passwords and an empty store.
  3. All pods 1/1. This answers Review Focus #3.
  4. `scripts\create-secrets.ps1` puts the LLM keys back from `.env`.
  5. `kubectl get pods -A` and `helm history urumi -n urumi-system` both look right.
- [ ] **Step 2: Check the LAN exposure.**
  - `curl.exe -m 5 http://127.0.0.1/ -H "Host: store.localhost"` → 200.
  - `curl.exe -m 5 http://<this machine's LAN IPv4>/ -H "Host: store.localhost"` → no response. Get the IP with `Get-NetIPAddress -AddressFamily IPv4 | Where-Object InterfaceAlias -notmatch 'Loopback|vEthernet|WSL'`.
  - `docker port k3d-urumi-serverlb` shows `127.0.0.1` bindings.
- [ ] **Step 3: Check the client IP.**
  - Locally, every request comes through the k3d proxy. Confirm and document what the gateway sees:
    1. temporarily run one login with a wrong password from two different sources (the host, and a `kubectl run` pod through the ingress);
    2. observe that the limiter treats them separately or together.
  - Record the observation in `security.md`, along with why it is acceptable now that the cluster is loopback-only, and the prod `externalTrafficPolicy: Local` setting (Task 5.6). The VPS behaviour is labelled "expected; not tested (k3d always proxies)".
- [ ] **Step 4: Run the smoke test.** `scripts\smoke-test.ps1` → all rows PASS. `npm audit` findings at high or above are fixed (update the pinned version) or recorded with a reason in `security.md`.
- [ ] **Step 5: Run the definition-of-done demo** following `docs/demo-script.md`:
  - user A (admin) uses the dashboard chat for a cross-server prompt, for example "create a draft product called Demo Lamp priced 25 and save a note reminding me to publish it";
  - user B (an invited member) uses an API key with the MCP Inspector CLI for `tools/list` and one call. Claude Code is the owner's to try, because it changes their Claude configuration;
  - revoke user B's key → 401;
  - disable user B → their session ends;
  - kill a pod: `kubectl -n mcp delete pod -l app.kubernetes.io/name=mcp-notes` → the Servers page shows Unreachable, then Connected within 30 s, and a notes call during the outage gets a clean error;
  - the audit log shows every step with the right source and user.

  Fix failures with systematic-debugging, one `fix:` commit each.
- [ ] **Step 6: Final checks.**
  - `npm test` 3 times back to back, recording the counts;
  - typecheck, lint, build;
  - `validate-chart.ps1`;
  - the link check over `docs/` and `README.md` (0 broken);
  - the secret scan of the branch diff (0 matches).
- [ ] **Step 7: Commit.**
  - `build: bind the local cluster to loopback only`
  - `test: one-command smoke test and invite-log check`
  - `docs: definition-of-done demo script verified end to end`
  - `docs: Phase 5 carry-forward resolutions`

---

## Exit criteria

- Every master-plan "Carry-forward → Phase 5" box is ticked with a pointer to how it was resolved. The parts that need a real VPS are labelled "rehearsed on k3d only": Let's Encrypt issuance, client-IP preservation with `externalTrafficPolicy: Local`, and the arm64 images. Every Phase 4 deferred item assigned to Phase 5 (#2, #3, #4, #7, #8, #9, #30, #32–#36 and the invite-log check) is resolved.
- **The local cluster:**
  - is loopback-only and was freshly installed under `restricted` PSA and default-deny NetworkPolicies;
  - `smoke-test.ps1` is green.
- **The production values:**
  - lint, render and kubeconform cleanly;
  - were installed into a second k3d cluster with TLS, the redirect, HSTS, `Secure` cookies and NetworkPolicies verified.
- **Docs:** the run guide, security, deployment, testing, troubleshooting and the ADRs (016, 017) describe exactly what was verified.
