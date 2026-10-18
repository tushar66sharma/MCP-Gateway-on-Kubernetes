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
| Architecture overview | Clients, Traefik, the three namespaces, upstream MCP servers, LLM | [architecture.md](../architecture.md) | Available (target architecture; its components are planned) |
| Hello-world request path | How a request reaches a pod through Traefik, Ingress and Service on the local cluster | [learning/01-kubernetes-primer.md](../learning/01-kubernetes-primer.md) | Available |
| Store install sequence | `deploy.ps1` to Helm to the hook Job, with decision points | [workflows.md](../workflows.md) | Available (Phase 1) |
| Store checkout sequence | A customer placing a Cash-on-delivery order on the store | [workflows.md](../workflows.md) | Available (Phase 1) |
| WooCommerce REST (OAuth1) sequence | Signing base URL versus target URL | [workflows.md](../workflows.md) | Available (Phase 1) |
| Store resource map | The store's Pods, Services, PVCs, Secrets and the Job in namespace `store` | [architecture.md](../architecture.md) | Available (Phase 1) |
| MCP tool-call sequence | Client to gateway to upstream and back, including routing and failure paths | Planned | (planned) — Phase 3 |
| Upstream health state machine | Upstream states and transitions driven by health checks | Planned | (planned) — Phase 3 |
| Credential flow | How client API keys and upstream credentials are kept separate and used | Planned | (planned) — Phase 3 |
| Auth and API-key lifecycle | Invites, sessions, key creation, use and revocation | Planned | (planned) — Phase 3 |
| Chat agent loop | Dashboard chat, LLM calls and loopback tool calls through `/mcp` | Planned | (planned) — Phase 4 |
| NetworkPolicy map | Which pods may talk to which | Planned | (planned) — Phase 5 |
| Helm / Kubernetes resource map | Resources created by the chart per namespace | Planned | (planned) — Phases 5-6 |

Planned diagrams will be added to this directory (or to the relevant document) in the phase shown, and this index updated at the same time.
