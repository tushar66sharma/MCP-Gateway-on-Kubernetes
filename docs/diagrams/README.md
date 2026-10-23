# Diagrams

Diagrams are written in [Mermaid](https://mermaid.js.org/) inside Markdown files, so they are version-controlled, diffable and rendered directly by GitHub and most editors.

## Convention

- Every diagram is a fenced `mermaid` code block in a Markdown file.
- Every diagram is accompanied by text that explains the **actors or components involved, the sequence of operations, and the important decision points** (including what happens on failure).
- A diagram is updated in the same change that alters the workflow it depicts. A diagram must never describe behavior that is not implemented; planned diagrams stay marked as planned until the code exists.
- Diagrams that belong to a single narrative (for example the architecture overview) may live in the document that explains them, and are indexed here.

## Diagram index

| Diagram | Shows | Where | Status |
|---|---|---|---|
| Architecture overview | Clients, Traefik, the three namespaces, upstream MCP servers, LLM | [architecture.md](../architecture.md) | Available (target architecture; everything in it is built since Phase 4 except the NetworkPolicies, Phase 5) |
| Hello-world request path | How a request reaches a pod through Traefik, Ingress and Service on the local cluster | [learning/01-kubernetes-primer.md](../learning/01-kubernetes-primer.md) | Available |
| Store install sequence | `deploy.ps1` to Helm to the hook Job, with decision points | [workflows.md](../workflows.md) | Available (Phase 1) |
| Store checkout sequence | A customer placing a Cash-on-delivery order on the store | [workflows.md](../workflows.md) | Available (Phase 1; expected flow, verified by the manual exit check) |
| WooCommerce REST (OAuth1) sequence | Signing base URL versus target URL | [workflows.md](../workflows.md) | Available (Phase 1) |
| Customer account and order history sequence | A shopper registers, orders and sees the order under My Account → Orders | [workflows.md](../workflows.md#5-customer-account-and-order-history) | Available (Phase 1b; verified by `customer-order-smoke.ps1`) |
| What runs where | Windows, Docker Desktop, the k3d containers and the pods inside the node (includes the MCP server pod since Phase 2) | [run-guide.md](../run-guide.md#1-what-runs-where) | Available (Phase 1b, updated in Phase 2) |
| Store resource map | The store's Pods, Services, PVCs, Secrets and the Job in namespace `store` | [architecture.md](../architecture.md) | Available (Phase 1) |
| MCP server resource map | The `mcp` namespace (Service, Deployment, Secrets) and its signed calls into the store | [architecture.md](../architecture.md#the-woocommerce-mcp-server-built-in-phase-2) | Available (Phase 2; the pod, Service and Secrets were checked in the cluster) |
| MCP tool call to the store sequence | Client to `mcp-woocommerce` (Host and bearer checks, zod validation) to WooCommerce REST (OAuth1 signed with the public URL, sent to the Service DNS name) to MariaDB, with failure cases | [workflows.md](../workflows.md#6-mcp-tool-call-to-the-store) | Available (Phase 2; the successful path and the 401, 403 and `isError` paths were run, other failures are unit-tested) |
| MCP discovery, `tools/list` and `tools/call` flow | The stateless 2026-07-28 flow with captured JSON | [learning/02-mcp-protocol.md](../learning/02-mcp-protocol.md#4-the-flow-we-actually-use) | Available (Phase 2; messages captured from the running server) |
| Gateway resource map | The `gateway` namespace (Ingress, Service, Deployment, Postgres, Secrets) and its calls to the `mcp` namespace | [architecture.md](../architecture.md#the-gateway-built-in-phase-3) | Available (Phase 3; the pods, Service and Ingress were checked in the cluster) |
| Gateway components | Clients, Traefik, gateway, Postgres and the three upstreams | [system-design.md](../system-design.md#1-components) | Available (Phase 3) |
| Gateway data model (ER) | The six Postgres tables and their foreign key actions | [system-design.md](../system-design.md#2-data-model) | Available (Phase 3; matches the migration and the live database) |
| Upstream health state machine | Upstream states (`unknown`, `connected`, `unreachable`, `disabled`) and transitions driven by health checks and call failures | [system-design.md](../system-design.md#4-the-upstream-manager) | Available (Phase 3; the connected/unreachable transitions were observed with the isolation check) |
| Register an upstream sequence | Admin to SSRF guard, encryption, Postgres, manager, upstream and `tools/list` | [workflows.md](../workflows.md#7-register-an-upstream-and-how-it-appears-in-toolslist) | Available (Phase 3; seeded path run live, the rest covered by tests) |
| MCP tool-call sequence through the gateway | Client to gateway to upstream and back, including routing and failure paths | [workflows.md](../workflows.md#8-mcp-tool-call-through-the-gateway) | Available (Phase 3; success, `isError`, denied and 401 paths run live, timeout and connection failure covered by tests) |
| Credential flow | How client API keys and upstream credentials are kept separate and used | [security.md](../security.md#1-two-credentials-that-never-meet) and [learning/03-gateway.md](../learning/03-gateway.md#4-hashing-versus-encryption-and-the-auth-flow) | Available (Phase 3) |
| Auth and API-key lifecycle | Login, key creation, use and revocation | [workflows.md](../workflows.md#9-api-key-lifecycle-create-use-revoke) | Available (Phase 3; run live) |
| Invite a teammate sequence | Invite creation, link delivery, preview, accept, cancel | [workflows.md](../workflows.md#10-invite-a-teammate) | Available (Phase 3; accept covered by tests, the rest run live) |
| Upstream goes down and comes back sequence | Health check failure, tools vanish, recovery with a fresh client | [workflows.md](../workflows.md#11-upstream-goes-down-and-comes-back) | Available (Phase 3; timings measured live) |
| Dashboard and chat resource map | The `dashboard` pod beside the gateway, the Ingress split (`/` to nginx, `/api` and `/mcp` to the gateway), the `llm-api-keys` Secret and the call to the LLM provider | [architecture.md](../architecture.md#the-dashboard-and-the-chat-agent-built-in-phase-4) | Available (Phase 4; pods, Ingress paths and Secret checked in the cluster) |
| Log in to the dashboard sequence | SPA fallback, `/api/auth/me`, login with CSRF and the limiter, the session-expiry redirect with `next` | [workflows.md](../workflows.md#12-log-in-to-the-dashboard-and-what-happens-when-the-session-ends) | Available (Phase 4; login and logout run by Playwright, expiry unit-tested) |
| Accept an invite sequence | Team page invite, the link page, preview, accept, session start | [workflows.md](../workflows.md#13-accept-an-invite-in-the-browser) | Available (Phase 4; create and cancel run by Playwright, accept unit-tested) |
| Create an API key in the dashboard sequence | Create, the one-time dialog with client setups, list | [workflows.md](../workflows.md#14-create-an-api-key-in-the-dashboard) | Available (Phase 4; run by Playwright at desktop and phone width) |
| Chat turn sequence (tool loop, retries, fallback) | Dashboard chat, the per-user refusals, the loopback MCP client with a token per request, LLM retries and the one-shot fallback, audited tool calls | [workflows.md](../workflows.md#15-a-chat-turn-tool-loop-retries-and-fallback) | Available (Phase 4; the success path run live with Groq, failure paths unit-tested, fallback not tested live) |
| The LLM layer | Route, service, agent, registry, the one OpenAI-compatible adapter configured for Groq and OpenRouter | [ai-integration.md](../ai-integration.md#1-the-layer) | Available (Phase 4) |
| Admin edits a server sequence | The form's origin check, `PATCH` with SSRF and the origin rule, encryption, upsert and health check | [workflows.md](../workflows.md#16-an-admin-edits-a-server-and-the-url-origin-rule) | Available (Phase 4; component and API tests, not run live) |
| NetworkPolicy map | Which pods may talk to which | [network-policies.md](network-policies.md) | Available (Phase 5, Task 5.3; verified live by `scripts/test-network-policies.ps1` on 2026-10-22) |
| Helm / Kubernetes resource map | Resources created by the chart per namespace | Planned | (planned) — Phase 6 (Phase 5 added the [NetworkPolicy map](network-policies.md) instead) |

Planned diagrams will be added to this directory (or to the relevant document) in the phase shown, and this index updated at the same time.
