# Documentation map

This is the index of all project documentation. Status is honest: **Available** means the file exists in the repository today; **(planned)** means it has not been written yet and names the phase of the [implementation plan](superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) that will produce it. Planned documents have no placeholder files.

## How to read these docs

If you are new to the project, read in this order:

1. **The design spec:** [superpowers/specs/2026-10-18-mcp-gateway-design.md](superpowers/specs/2026-10-18-mcp-gateway-design.md). The source of truth for what we are building and why.
2. **To run the project:** [run-guide.md](run-guide.md). One command starts it; the guide explains every part.
3. **The architecture overview:** [architecture.md](architecture.md). The components, how they connect, and which namespaces they live in (target architecture; the store, the three MCP servers, the gateway with its Postgres database, the dashboard and the chat agent are built, and Phase 5 added the NetworkPolicies, Pod Security `restricted` and the production values).
4. **The Kubernetes primer:** [learning/01-kubernetes-primer.md](learning/01-kubernetes-primer.md). The Kubernetes concepts the project uses, each tied to a command you can run against the local cluster.
5. **The MCP protocol:** [learning/02-mcp-protocol.md](learning/02-mcp-protocol.md). What MCP is and how our server speaks it, with real captured requests and responses.
6. **The gateway:** [learning/03-gateway.md](learning/03-gateway.md) (client and server at once, cached catalog, naming, hashing versus encryption, real captured gateway traffic), then [system-design.md](system-design.md).
7. **The chat agent:** [learning/04-chat-agent.md](learning/04-chat-agent.md) (the tool loop, acting as the user, a real captured LLM request and response), then [ai-integration.md](ai-integration.md).
8. **The decision records:** [decisions/README.md](decisions/README.md). One short ADR per significant choice, with alternatives and trade-offs.

## Document index

| Document | Purpose | Status |
|---|---|---|
| [run-guide.md](run-guide.md) | **Start here to run things.** How to start, use, inspect and reset every part of the project, for Kubernetes beginners; grows each phase | Available (store from Phase 1, the WooCommerce MCP server from Phase 2, the gateway and its Postgres database from Phase 3, the dashboard and "Set up the AI chat" from Phase 4) |
| [architecture.md](architecture.md) | High-level architecture, components, responsibilities, technology choices | Available (store built in Phase 1, the WooCommerce MCP server in Phase 2, the gateway, Postgres and two more MCP servers in Phase 3, the dashboard and chat agent in Phase 4; NetworkPolicies, Pod Security and the production values in Phase 5) |
| [system-design.md](system-design.md) | Detailed design: component interactions, data flow, interfaces, trade-offs | Partial: the gateway as built in Phase 3, the dashboard and chat agent in Phase 4; completed in Phase 6 |
| [workflows.md](workflows.md) | Step-by-step explanation of the major workflows | Available (store workflows from Phase 1, the MCP tool call to the store from Phase 2, five gateway workflows from Phase 3, five dashboard and chat workflows from Phase 4; complete in Phase 6) |
| [diagrams/](diagrams/README.md) | Architecture, sequence, data-flow and workflow diagrams (Mermaid) | Available (index; store diagrams since Phase 1, MCP server diagrams since Phase 2, gateway diagrams since Phase 3, dashboard and chat diagrams since Phase 4) |
| [ai-integration.md](ai-integration.md) | LLM provider abstraction, model choice (the spike), key setup, quotas, failures, switching providers | Available (Phase 4) |
| [error-handling.md](error-handling.md) | Failure scenarios, retries, timeouts, fallbacks, user-facing errors | Partial: the gateway, the upstreams and Postgres (Phase 3); the chat and the dashboard (Phase 4); complete in Phase 6 |
| [security.md](security.md) | Authentication, authorization, secrets, input validation, hardening | Partial: credentials, auth, CSRF, SSRF, logging, roles, residual risks (Phase 3); browser headers, the chat acting as the user, prompt injection, LLM keys (Phase 4); NetworkPolicies, Pod Security, the loopback-only cluster, production TLS and secrets (Phase 5); threat model Phase 6 |
| [testing.md](testing.md) | Test strategy, commands and verification procedures | Partial: test layers, commands, counts, cluster and browser checks as of Phase 4; completed in Phase 6 |
| [decisions/](decisions/README.md) | Architecture decision records (ADR-001 to ADR-017) | Available |
| [troubleshooting.md](troubleshooting.md) | Common development, configuration and deployment problems with fixes | Available (store problems from Phase 1, MCP server problems from Phase 2, gateway and Postgres problems from Phase 3, dashboard and chat problems from Phase 4; complete in Phase 6) |
| [deployment.md](deployment.md) | Beginner-friendly deployment guide (local k3d and k3s on a VPS) | Available (local k3d from Phase 1, image build and MCP server from Phase 2, gateway and Postgres from Phase 3, dashboard and the AI key Secret from Phase 4; the k3s VPS section from Phase 5, rehearsed on a second k3d cluster, not run on a real VPS) |
| [screenshots/](screenshots/) | Dashboard screenshots taken from the local cluster (no keys, links or passwords shown) | Available (Phase 4) |
| system-design-and-tradeoffs.md | Short note: architecture choices, routing and failure handling, what changes for production | (planned) — Phase 6 |
| threat-model.md | Short note: shared upstream credentials, token passthrough, malicious tool descriptions, compromised upstreams | (planned) — Phase 6 |
| [demo-script.md](demo-script.md) | Step-by-step definition-of-done demo (chat across servers, invite, key, MCP Inspector, revoke, disable, pod kill, audit), each step run on 2026-10-23 | Available (Phase 5) |
| stand-out-items.md | Which stand-out items were done (with file pointers) and which were not attempted | (planned) — Phase 6 |
| [learning/](learning/00-setup-log.md) | Interview-prep primers: [setup log](learning/00-setup-log.md), [Kubernetes primer](learning/01-kubernetes-primer.md), [MCP protocol](learning/02-mcp-protocol.md), [the gateway](learning/03-gateway.md) (Phase 3, with captured traffic), [the chat agent](learning/04-chat-agent.md) (Phase 4, with a captured LLM exchange); the final interview Q&A is (planned) — Phase 6 | Available (partial) |
| [superpowers/specs/](superpowers/specs/2026-10-18-mcp-gateway-design.md) | The approved design spec | Available |
| [superpowers/plans/](superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) | The phased implementation plan | Available |

The repository root [README.md](../README.md) is the beginner entry point; its "Links to Documentation" section points here.
