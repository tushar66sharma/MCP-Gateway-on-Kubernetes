# Stand-out items and bonus

Which of the assignment's optional items were attempted, what exists, where to find it, and the honest limits. Status words: **done**, **partial** (with exactly what), **documented** (written down, not built), **not attempted**. Labels: **tested** = pinned by an automated test; **live** = run on the local k3d cluster on the date given; **expected** = follows from the code or documentation, not run.

## Summary

| Item | Status | One line |
|---|---|---|
| Bonus: multi-store provisioning | **not attempted** | One store only |
| #6 Security hardening | **done** | SSRF guard, default-deny NetworkPolicies, non-root and `restricted` Pod Security, credentials encrypted at rest; no component uses the Kubernetes API |
| #1 Production-like VPS deployment | **partial** | Production values and a guide, rehearsed on a second k3d cluster; **not deployed on a real VPS** |
| #7 Scaling | **partial** | Per-user chat limits and daily budget, login limiter, per-IP `/mcp` failure limiter; **not** multi-replica, **not** per key |
| #8 Observability | **partial** | `lastError` reasons, the audit log and log lines; **no metrics** |
| #9 Upgrades and rollback | **documented** | Plus what was run (below) |
| #2 Tool permissions | **not attempted** | |
| #3 OAuth on the gateway | **not attempted** | |
| #4 Handling many tools | **not attempted** | |
| #5 Hosted MCP servers | **not attempted** | |

## Bonus: multi-store provisioning, not attempted

There is one store, installed by the chart in namespace `store`. There is no provisioning component, no store list in the dashboard, no per-store namespace, quota or `LimitRange`. The chart can run without the in-cluster store and point the WooCommerce MCP server at a store hosted elsewhere (see Extras), which is not provisioning.

## #6 Security hardening: done

The assignment names four parts.

- **SSRF protection when an admin adds a URL.** `apps/gateway/src/security/ssrf.ts`, applied on create, edit, every health check and at connect time (DNS rebinding closed); no redirects; no URL credentials; a stored credential stays bound to its origin. **Tested** (`ssrf.test.ts`, 39 tests) and **live** 2026-10-19: the metadata address, loopback, a private address, `file:` and `user:pw@` URLs were refused. [security.md §5](security.md#5-ssrf-guard).
- **Least-privilege RBAC for any component that talks to the Kubernetes API.** **No component talks to the Kubernetes API**: the gateway, the MCP servers, the dashboard and the databases make no Kubernetes calls, so the chart creates no `ServiceAccount`, `Role` or `RoleBinding` (checked on the render, 2026-10-23), and every pod and Job sets `automountServiceAccountToken: false`, so no ServiceAccount token is mounted. The requirement does not apply; this is a design choice, not a skipped item. Template lines: `charts/urumi-platform/templates/_helpers.tpl` and each workload.
- **NetworkPolicies that deny by default, and containers that run as non-root.** `charts/urumi-platform/templates/network/` renders **16** NetworkPolicies (a default-deny and DNS policy per namespace, plus the allow matrix). **Live** 2026-10-23: `scripts\test-network-policies.ps1` passed 13 of 13 probes on the local and on the rehearsal cluster. The three namespaces enforce Pod Security `restricted` (non-root, seccomp `RuntimeDefault`, no privilege escalation, all capabilities dropped); a non-compliant pod was refused live (2026-10-22) and a fresh install was admitted (2026-10-23). [security.md §8.5, §15](security.md#85-pod-security-phase-5-task-54), [ADR-016](decisions/ADR-016-default-deny-network-policies.md), [ADR-017](decisions/ADR-017-pod-security-restricted.md).
- **Upstream credentials encrypted at rest.** AES-256-GCM with a fresh nonce and the server row id as associated data (`apps/gateway/src/security/crypto.ts`), **tested**; **live** 2026-10-19: `credential_enc` is 76 bytes for each server. [ADR-009](decisions/ADR-009-upstream-credential-encryption.md).

**Limits.** Key rotation for `GATEWAY_ENCRYPTION_KEY` is not built. The internet rule allows any public host on ports 80 and 443. A new pod is open for 3 to 6 s until kube-router programs it. Kubernetes Secrets are not encrypted at rest by us (a k3s option not enabled). The Helm release Secret holds rendered Secrets ([threat-model.md §5](threat-model.md#5-other-residual-risks)). Eviction of an `emptyDir` over its limit was not tested. Residual list: [security.md §8](security.md#8-residual-risks).

## #1 Production-like VPS deployment: partial

**Exists.** [`deploy/values-prod.yaml`](../deploy/values-prod.yaml) (domain, https, TLS through cert-manager, pre-created Secrets, GHCR images, larger volumes, registration off), `deploy/prod/` (Let's Encrypt and self-signed `ClusterIssuer`s, Traefik `externalTrafficPolicy: Local`), `scripts/prod/create-prod-secrets.sh`, and the guide [deployment.md, Production (k3s VPS)](deployment.md#production-k3s-vps) with the values diff, backups, upgrade and rollback. The chart adds TLS Certificates, an http-to-https redirect and HSTS when TLS is on.

**Verified.** `helm lint` and `kubeconform` on the production values; the Secrets script on a throw-away cluster; and a **rehearsal on a second local k3d cluster** on 2026-10-23 with `scripts\prod-rehearsal.ps1`: pods ready under `restricted`, both certificates `Ready` (self-signed issuer), `301` to https, HSTS, a `Secure` cookie, 13 of 13 NetworkPolicy probes, `check-gateway.ps1` over https. The rehearsal found and fixed two real faults ([deployment.md](deployment.md#rehearsal-results-2026-10-23)).

**Not done.** **No real VPS, domain, Let's Encrypt certificate, GHCR push, multi-arch (arm64) image, real client IP (`externalTrafficPolicy: Local`) or backup restore has been run.** Those steps are written and marked **not executed**.

## #7 Scaling: partial

**Exists (rate limits).**
- Chat: 10 turns a minute per user, one turn in flight per user, and a daily token budget of 50,000 per user (`CHAT_RATE_LIMIT_PER_MIN`, `CHAT_DAILY_TOKEN_BUDGET`; `apps/gateway/src/chat/`, `usageRepo.ts`; [ADR-020](decisions/ADR-020-chat-guardrails.md)).
- Login: 10 attempts a minute per IP and email (`apps/gateway/src/auth/rateLimit.ts`; **live** 2026-10-23: the 11th got `429`).
- `/mcp`: recognised authentication failures are limited to 30 a minute per IP, `429` with `Retry-After` (**live** 2026-10-22). Valid keys are exempt.

**Not done.**
- **There is no per-key limit on valid calls.** The limits are per user (chat) or per IP (failures, logins).
- **Not multi-replica.** One gateway replica with the `Recreate` strategy. Catalog, health and limiter state are in memory per replica, so a second replica would need a shared catalog or periodic resync. The stateless `/mcp` endpoint and the Postgres advisory lock for migrations are the groundwork; a multi-replica run was **not tested** ([system-design.md §8](system-design.md#8-trade-offs-and-limits)).

## #8 Observability: partial

**Exists.**
- **Reasons for failures.** Every server shows `status` and a readable `lastError` (`connection refused`, `timeout after 5000ms`, `HTTP 401 from upstream`, `DNS lookup failed`) in the dashboard and the API (`apps/gateway/src/upstreams/manager.ts`, `apps/dashboard/src/pages/ServerDetail.tsx`). A call's failure comes back as a clear `isError` text and an audit outcome (`success`, `error`, `timeout`, `denied`, `unauthorized`) with a message.
- **The audit log**, with filters, in the dashboard's Audit page and `GET /api/audit`.
- **Structured log lines** (pino, secrets redacted): `tool call` (name, server, outcome, duration, user, source), `chat turn`, rejected-authentication warnings.

**Not done.** **No metrics**: no `/metrics` endpoint, no Prometheus, no error-rate or latency per server dashboard. Duration and outcome are in the audit rows and could be aggregated by SQL; nothing does.

## #9 Upgrades and rollback: documented

**Exists.** Local: [deployment.md, Steps 7 and 8](deployment.md#step-7-upgrade-change-settings-or-the-chart). Production: [section 11](deployment.md#11-upgrade-and-roll-back) (`helm upgrade`, `helm history`, `helm rollback`), plus backups ([section 12](deployment.md#12-backups)). Design that helps: the gateway uses `Recreate` and migrations run under an advisory lock; data volumes and generated Secrets are kept across upgrades and uninstall; `helm rollback` does not undo database changes, so back up first.

**What was run.**
- **Upgrade:** `helm upgrade` has run many times on the local cluster: the release was at revision 24 on 2026-10-23, each deployed by `scripts\deploy.ps1` or `scripts\up.ps1 -Redeploy`; passwords and data were unchanged.
- **Uninstall and reinstall** over the kept volumes and Secrets (2026-10-18, [workflows.md](workflows.md#4-data-lifecycle-upgrade-uninstall-reinstall-fresh-install)), and a **fresh install from nothing** (2026-10-23).
- **Backups:** both dump commands produced non-empty dumps on the local cluster (2026-10-23).

**Not run.** **`helm rollback` was never executed** (the commands are documented from Helm's behaviour), a restore from a backup, and any upgrade or rollback on a real VPS.

## #2 Tool permissions, #3 OAuth, #4 Handling many tools, #5 Hosted MCP servers: not attempted

- **#2:** roles are `admin` and `member` only and both can call every tool; there is no per-server or per-tool allow-list ([threat-model.md §1](threat-model.md#1-shared-upstream-credentials-what-a-member-can-do-with-a-credential-they-never-see)).
- **#3:** the gateway accepts API keys (and the chat's internal token) only. There is no OAuth flow; the dashboard answers `/.well-known/*` with `404` so clients that probe for OAuth metadata fail cleanly.
- **#4:** `tools/list` returns every tool of every enabled server (15 now). There is no search-then-execute layer. The chat sends all tools to the model with descriptions cut to 300 characters.
- **#5:** an admin registers a URL, not a container image. The platform does not deploy servers. (A server that already runs in the cluster can be registered with `gateway.internalUpstreams`, below.)

## Extras beyond the list

Labelled as extras; none of them is a listed stand-out item.

- **Chat guardrails** ([ADR-020](decisions/ADR-020-chat-guardrails.md), [ai-integration.md §9](ai-integration.md#9-guardrails-scope-topic-check-answer-cap-and-daily-budget-phase-5b)): a scope rule, an on-topic check, a 1,024-token answer cap and the per-user daily budget. Live 2026-10-23: an off-topic request was refused before the main model ran; a topic-probe script allowed 16 of 16 and blocked 14 of 14 in each of three runs. A determined or forged-history request can pass ([threat-model.md §5](threat-model.md#5-other-residual-risks)).
- **An external WooCommerce store** ([ADR-019](decisions/ADR-019-external-woocommerce-store.md), [deployment.md](deployment.md#using-a-woocommerce-store-hosted-elsewhere)): Basic auth over https only, TLS verification on, no credentials in URLs. The server code was run against the local store over https with a throw-away CA (2026-10-23). The chart's external mode was **rendered and linted, not installed**; a real remote host was not tested.
- **In-cluster MCP servers of your own** ([deployment.md](deployment.md#registering-mcp-servers-that-run-inside-the-cluster)): `gateway.internalUpstreams` adds the SSRF allow-list entry and the NetworkPolicy rules. **Live** 2026-10-23 with `scripts\dev\test-internal-upstream.ps1`: a test server was refused, then `connected` with 4 tools after the setting, then removed.
- **WordPress cron as a CronJob** ([ADR-018](decisions/ADR-018-wordpress-cron-via-cronjob.md)), **an invite flow** ([ADR-013](decisions/ADR-013-invite-links.md)) and a **Playwright browser smoke** of the dashboard (`apps/dashboard/e2e`, `scripts\check-dashboard.ps1`, 17 tests on 2026-10-22).
