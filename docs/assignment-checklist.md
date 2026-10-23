# Assignment checklist

Every mandatory requirement and every "definition of done" bullet of the assignment, with where it is in the repository and how it was verified. Wording of the definition of done is the assignment's, word for word (page 3); requirement wording is shortened.

Labels: **tested** = pinned by an automated test (`npm test`, 671 tests, 2026-10-23, [testing.md](testing.md)); **live** = run on the local k3d cluster on the date given; **rendered** = checked on the output of `helm template` with `deploy/values-local.yaml` on 2026-10-23; **expected** = follows from the code or documentation, not run; **owner's live step** = to be done in the demo video, not by a script. `scripts\smoke-test.ps1` (8 steps) passed 8 of 8 on 2026-10-23 and runs the `check-*.ps1` scripts named below.

## 1. Definition of done

Demo steps and the observed values are in [demo-script.md](demo-script.md) (run live at API level on 2026-10-23; the browser click-through and Claude Code are the owner's live steps).

| Definition of done | Where in the repo | How verified |
|---|---|---|
| **Store.** Open the storefront, add a product to the cart and check out with a test-friendly method (COD or a dummy gateway is fine). | Store: `charts/urumi-platform/templates/store/`, setup Job `charts/urumi-platform/files/store-setup/`; COD is enabled by the setup Job; script `scripts/dev/customer-order-smoke.ps1` | Live 2026-10-23: order #20 placed with COD through the Store API ([demo step 1](demo-script.md#1-store-storefront-to-checkout-to-wp-admin)); in the smoke test step list too. Browser click-through: owner's live step |
| **Store.** Confirm the order is visible in WooCommerce admin. | wp-admin at `store.localhost/wp-admin` ([run-guide.md §6](run-guide.md#6-using-the-store)) | Order read back through the gateway (`woo__list_orders`, status `processing`). **Not click-verified in wp-admin**: owner's live step |
| **Chat agent, as user A.** Ask the agent to create a product with a name and price. The product appears on the storefront. | Chat: `apps/gateway/src/chat/`, `apps/dashboard/src/pages/Chat.tsx`; tool `apps/mcp-woocommerce/src/tools/createProduct.ts` | Live 2026-10-23: product 19 `Demo Lamp`, status `publish`, `/product/demo-lamp/` returned HTTP 200 ([demo step 2](demo-script.md#2-chat-agent-as-user-a)) |
| **Chat agent, as user A.** Place an order for it on the storefront by hand, then ask the agent what orders came in today. It returns that order. | `listOrders.ts` with `period=today`; `packages/shared/src/period.ts` | Live 2026-10-23: order #20 for product 19 placed by script; the chat listed #20. "By hand" is the owner's live step |
| **External MCP client, as user B.** Connect Claude Code, Cursor or MCP Inspector to the gateway using only the gateway URL and user B's API key. | Endpoint `apps/gateway/src/mcp/endpoint.ts`; setup in [run-guide.md, Connect Claude Code](run-guide.md#connect-claude-code) | Live 2026-10-23 with MCP Inspector (URL and key only). Claude Code and Cursor: **not tested**, owner's live step |
| **External MCP client, as user B.** See the tools of every enabled server. | Cached catalog `apps/gateway/src/upstreams/manager.ts` | Live 2026-10-23: `tools/list` returned 15 tools (woo 6, notes 5, utils 4); also `check-gateway.ps1` |
| **External MCP client, as user B.** ...and ask the same orders question successfully. | as above | Live 2026-10-23: `woo__list_orders` `period=today` returned #20 |
| **External MCP client, as user B.** Run one prompt that needs tools from two different upstream servers. | the chat and `/mcp` | Live 2026-10-23 through the chat as a second member: `woo__list_orders` then `notes__create_note`, both success. In Claude Code: owner's live step |
| **Team and control.** Revoke user B's key. Their next call is rejected. | `apps/gateway/src/auth/apiKeys.ts`, `DELETE /api/keys/:id` | Live 2026-10-23: revoke `204`, next call `401`; tested (revoked key fails on its next request) |
| **Team and control.** Disable one upstream server. Its tools disappear from both the chat agent and the external client. | `PATCH /api/servers/:id`, `apps/gateway/src/api/servers.routes.ts` | Live 2026-10-23: external client `tools/list` 15, then 10, then 15 after re-enabling. Chat agent: **inferred** (no `notes__*` call; a generic scope refusal, not a "notes is disabled" message) |
| **Team and control.** Kill the pod of one upstream server. The other servers keep working, and the dashboard shows the dead one as unreachable. | `apps/gateway/src/upstreams/manager.ts`, [ADR-014](decisions/ADR-014-cached-tool-catalog.md) | Live 2026-10-23: `utils` `unreachable` after 3.7 s, `woo__list_products` HTTP 200 meanwhile, `connected` again after 19.9 s. Status read through the API; the dashboard view is not click-verified. Also `check-gateway.ps1 -Isolation` (2026-10-19) |
| **Team and control.** Every call above appears in the audit log, attributed to the right user. | `apps/gateway/src/audit/writer.ts`, `apps/dashboard/src/pages/Audit.tsx` | Live 2026-10-23: audit rows 110 to 125 with the right user and source (`mcp` or `chat`), including the rejected calls of the revoked key; filter by user returned 7 and 5 rows ([demo step 5](demo-script.md#5-audit)) |

## 2. Mandatory requirements

### Kubernetes and Helm

| Requirement | Where | How verified |
|---|---|---|
| Runs on local Kubernetes (Kind, k3d or Minikube) | `deploy/k3d-config.yaml`, `scripts/cluster-up.ps1`, `scripts/up.ps1`; [run-guide.md](run-guide.md) | Live: fresh cluster install from nothing 2026-10-23; smoke test 8 of 8 |
| Deployable to a production-like VPS (k3s) with the same Helm charts | `deploy/values-prod.yaml`, `deploy/prod/`, [deployment.md](deployment.md#production-k3s-vps) | `helm lint`, `kubeconform`; **rehearsed on a second k3d cluster 2026-10-23**. **Not deployed on a real VPS** ([stand-out-items.md](stand-out-items.md#1-production-like-vps-deployment-partial)) |
| Helm is mandatory (no Kustomize); local and production differ through values files | `charts/urumi-platform`, `deploy/values-local.yaml`, `deploy/values-prod.yaml`; no `kustomization` file exists | `helm lint` with both files; `scripts\validate-chart.ps1` 126 PASS, 0 FAIL (2026-10-23, [testing.md](testing.md)) |
| Everything runs in the cluster: the store, its database, the WooCommerce MCP server, the gateway backend and the dashboard | Rendered kinds: `Deployment` (wordpress, gateway, dashboard, three MCP servers), `StatefulSet` (mariadb, postgres) | Rendered; all pods 1/1 after `up.ps1 -Redeploy` (2026-10-23) |
| The store's database and WordPress content use persistent storage | `StatefulSet mariadb` volume claim, PVC `wordpress-data`, `StatefulSet postgres` volume claim; `global.storageClass` | Live: data survived uninstall and reinstall (2026-10-18, [workflows.md](workflows.md#4-data-lifecycle-upgrade-uninstall-reinstall-fresh-install)); the Postgres pod deleted and data kept (2026-10-19) |
| The storefront and the dashboard are exposed through Ingress with stable URLs; document your local domain approach | `templates/store/ingress.yaml`, `templates/gateway/ingress.yaml`; `*.localhost` names ([deployment.md Step 2](deployment.md#step-2-make-localhost-names-resolve-for-every-tool)) | Live: `http://store.localhost` and `http://app.localhost` used in every check; two Ingresses rendered |
| Readiness and liveness checks on every workload, and resource requests and limits | each workload template under `charts/urumi-platform/templates/` | Rendered: all 8 long-running workloads have readiness and liveness probes (7 also a startup probe); all 10 workloads, the setup Job and the cron Job included, have requests and limits |
| No hardcoded secrets in source code; credentials live in Kubernetes Secrets | Secrets: `templates/*/secrets.yaml`, `store-secrets.yaml`; production `scripts/prod/create-prod-secrets.sh`; `.env` is git-ignored | Live: no key pattern in `helm get manifest` or the rendered chart ([security.md §13](security.md#13-llm-keys-and-chat-privacy)); secret scans each phase, repeated at the end of Phase 6 (Task 6.6). Helm release Secret caveat: [threat-model.md §5](threat-model.md#5-other-residual-risks) |

### WooCommerce MCP server

| Requirement | Where | How verified |
|---|---|---|
| Written by us; not an existing server or plugin | `apps/mcp-woocommerce` | The source in this repository (77 tests) |
| Speaks MCP over Streamable HTTP | `packages/shared/src/mcpHttpServer.ts`, [ADR-007](decisions/ADR-007-mcp-sdk-version.md) | Tested; MCP Inspector and the SDK client 2026-10-18 and 2026-10-23 |
| Tools: list products, create product, list orders, get order, update order status | `apps/mcp-woocommerce/src/tools/` (`listProducts`, `createProduct`, `listOrders`, `getOrder`, `updateOrderStatus`, plus `ping`) | Live: `check-mcp-woocommerce.ps1` and `check-gateway.ps1 -Write` (create product, update status), part of the smoke test 2026-10-23 |
| Not reachable from outside the cluster; only the gateway can call it | `ClusterIP` Service, no Ingress; `templates/network/mcp.yaml` | Rendered: only two Ingresses exist (store, gateway). Live: `scripts\test-network-policies.ps1` blocks other namespaces from reaching it (13 of 13 probes, 2026-10-23) |
| Document how it talks to the store and why | WooCommerce REST API v3 with OAuth 1.0a: [ADR-005](decisions/ADR-005-woocommerce-rest-oauth1.md), `apps/mcp-woocommerce/README.md`, [run-guide.md §8](run-guide.md#8-woocommerce-mcp-server-phase-2) | Spike live 2026-10-18 (signature base URL rule); signed writes live in Phase 2 |

### Gateway

| Requirement | Where | How verified |
|---|---|---|
| Admins can add, edit, disable and remove upstream servers (Streamable HTTP), each with an optional static credential (header or bearer) | `apps/gateway/src/api/servers.routes.ts`, dashboard `Servers.tsx`, `ServerDetail.tsx`; `auth_type` none, bearer or header | Tested (`test/api/servers.test.ts`); live: disable and enable 2026-10-23 |
| One MCP endpoint: listing returns the tools of every enabled server; calls are routed to the right server | `apps/gateway/src/mcp/endpoint.ts`, `src/upstreams/manager.ts` | Tested (`test/mcp/endpoint.test.ts`); live: 15 tools, `check-gateway.ps1` |
| Tool name collisions handled with a documented scheme | `<slug>__<tool>`, [ADR-006](decisions/ADR-006-tool-naming-scheme.md), [system-design.md §5](system-design.md#5-naming-adr-006) | Tested; live: three `ping` tools coexist (`check-gateway.ps1`) |
| A slow or dead upstream does not break listing or other calls; calls time out with a clear error | health loop 15 s / 5 s, call timeout 20 s ([system-design.md §4, §7](system-design.md#4-the-upstream-manager)) | Tested (`test/upstreams/manager.test.ts`); live: isolation run 2026-10-19 and pod kill 2026-10-23 (clear `isError`) |
| Upstream credentials stay on the server side, never sent to the browser or an MCP client | `apps/gateway/src/security/crypto.ts`; `ServerView` has `hasCredential` only | Tested (client key and credentials absent from headers, logs, API); live 2026-10-19 (`hasCredential`) |
| At least three upstream servers: ours and two others | `mcp-woocommerce`, `mcp-notes`, `mcp-utilities` (`apps/`), seeded by `SEED_SERVERS` | Live: 3 servers `connected`, 15 tools, 2026-10-23 |

### Team and access

| Requirement | Where | How verified |
|---|---|---|
| At least two roles: admin and member | `users.role` in `apps/gateway/src/db/schema.ts`; [security.md §7](security.md#7-what-a-member-can-and-cannot-do) | Tested (`test/api/*.test.ts`, 403 for members); live in the demo with two users |
| Each user has their own API key; revocable; stored hashed | `apps/gateway/src/auth/apiKeys.ts`, SHA-256 in `api_keys.key_hash` ([ADR-008](decisions/ADR-008-api-key-hashing.md)) | Tested; live: revoke `204`, then `401` (2026-10-23) |
| Every tool call is audited with user, server, tool, timestamp, duration and outcome; visible in the dashboard | `apps/gateway/src/audit/`, `apps/dashboard/src/pages/Audit.tsx`, `GET /api/audit` | Tested; live: rows 110 to 125 (2026-10-23); the Audit page is covered by the Playwright smoke (2026-10-22) |

### Chat agent

| Requirement | Where | How verified |
|---|---|---|
| A chat in the dashboard that uses an LLM to call tools through the gateway and shows which tools it called | `apps/gateway/src/chat/agent.ts`, `apps/dashboard/src/pages/Chat.tsx`, tool trace `apps/dashboard/src/features/chat/ToolCallTrace.tsx`, [ai-integration.md](ai-integration.md) | Tested with a scripted LLM; live: demo turns 2026-10-23 and one chat turn in the smoke test (2026-10-23) |
| It acts as the logged-in user; calls appear in the audit log under that user | internal token per request, `apps/gateway/src/auth/internalToken.ts`, [ADR-010](decisions/ADR-010-chat-agent-loopback.md) | Tested (`test/chat/mcpLoopback.test.ts`); live: audit rows with source `chat` and the right user (2026-10-23) |
| LLM API keys follow the same rule as every other secret | Secret `llm-api-keys`, `scripts/create-secrets.ps1`, [security.md §13](security.md#13-llm-keys-and-chat-privacy) | Live: no `last-applied-configuration`, no key in the rendered chart or logs (2026-10-19); `.env` git-ignored |

## 3. Bonus

| Item | Status |
|---|---|
| Multi-store provisioning | **Not attempted.** See [stand-out-items.md](stand-out-items.md#bonus-multi-store-provisioning-not-attempted) |

## 4. Deliverables and demo video

| Deliverable | Where | Status |
|---|---|---|
| README with local setup, VPS or production-like setup, how to place an order, connect an external MCP client and use the chat agent | [README.md](../README.md) (local and production sections), [run-guide.md](run-guide.md), [deployment.md](deployment.md) | The README is finished in Task 6.4; until then the run guide holds each of these |
| Source code: dashboard, backend and gateway, WooCommerce MCP server, chat agent | `apps/dashboard`, `apps/gateway` (chat in `src/chat`), `apps/mcp-woocommerce`, `packages/shared` | Present; `npm test` 671 of 671, typecheck, lint and build clean (2026-10-23) |
| Helm charts and values files (local and production) | `charts/urumi-platform`, `deploy/values-local.yaml`, `deploy/values-prod.yaml` | `helm lint` passes with both |
| "System design and tradeoffs" note | [system-design-and-tradeoffs.md](system-design-and-tradeoffs.md) | Written (Task 6.2) |
| Threat model note with the 4 required points | [threat-model.md](threat-model.md) | Written (Task 6.2): sections 1 to 4 |
| List of bonus and stand-out items attempted | [stand-out-items.md](stand-out-items.md) | Written (Task 6.2) |
| Demo video (6 sections) | Script for section 1: [demo-script.md](demo-script.md); sections 2 to 6: [architecture.md](architecture.md), [system-design.md](system-design.md), [security.md](security.md), [ai-integration.md](ai-integration.md), [deployment.md](deployment.md) | The owner records it; **not recorded yet** |
