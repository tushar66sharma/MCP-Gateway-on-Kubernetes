# Documentation map

This is the index of all project documentation. Status is honest: **Available** means the file exists in the repository today and describes what is built; anything that was not run is labelled *expected* or *not tested* inside the document. There are no placeholder files. The [implementation plan](superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) holds the history of how the project was built.

## How to read these docs

If you are new to the project, read in this order:

1. **The design spec:** [superpowers/specs/2026-10-18-mcp-gateway-design.md](superpowers/specs/2026-10-18-mcp-gateway-design.md). The source of truth for what we are building and why.
2. **To run the project:** [run-guide.md](run-guide.md). One command starts it; the guide explains every part.
3. **The architecture overview:** [architecture.md](architecture.md). The components, how they connect, and which namespaces they live in (everything in it is built: the store, the three MCP servers, the gateway with its Postgres database, the dashboard and the chat agent, plus the NetworkPolicies, Pod Security `restricted` and the production values, which were rehearsed on a second k3d cluster and not run on a real VPS).
4. **The Kubernetes primer:** [learning/01-kubernetes-primer.md](learning/01-kubernetes-primer.md). The Kubernetes concepts the project uses, each tied to a command you can run against the local cluster.
5. **The MCP protocol:** [learning/02-mcp-protocol.md](learning/02-mcp-protocol.md). What MCP is and how our server speaks it, with real captured requests and responses.
6. **The gateway:** [learning/03-gateway.md](learning/03-gateway.md) (client and server at once, cached catalog, naming, hashing versus encryption, real captured gateway traffic), then [system-design.md](system-design.md).
7. **The chat agent:** [learning/04-chat-agent.md](learning/04-chat-agent.md) (the tool loop, acting as the user, a real captured LLM request and response), then [ai-integration.md](ai-integration.md).
8. **The decision records:** [decisions/README.md](decisions/README.md). One short ADR per significant choice, with alternatives and trade-offs.

## Document index

| Document | Purpose | Status |
|---|---|---|
| [run-guide.md](run-guide.md) | **Start here to run things.** How to start, use, inspect and reset every part of the project, for Kubernetes beginners; final as of Phase 6 | Available (store from Phase 1, the WooCommerce MCP server from Phase 2, the gateway and its Postgres database from Phase 3, the dashboard and "Set up the AI chat" from Phase 4; "Connect Claude Code" with its `.mcp.json` option from Phase 5b) |
| [architecture.md](architecture.md) | High-level architecture, components, responsibilities, technology choices | Available (store built in Phase 1, the WooCommerce MCP server in Phase 2, the gateway, Postgres and two more MCP servers in Phase 3, the dashboard and chat agent in Phase 4; NetworkPolicies, Pod Security and the production values in Phase 5) |
| [system-design.md](system-design.md) | Detailed design: component interactions, data flow, interfaces, trade-offs | Available (final: the gateway, the dashboard and chat agent, and network isolation, Pod Security and production values in section 11) |
| [workflows.md](workflows.md) | Step-by-step explanation of the major workflows | Available (store workflows from Phase 1, the MCP tool call to the store from Phase 2, five gateway workflows from Phase 3, five dashboard and chat workflows from Phase 4; final: 16 workflows) |
| [diagrams/](diagrams/README.md) | Architecture, sequence, data-flow and workflow diagrams (Mermaid) | Available (final: every indexed diagram exists, including the [Helm resource map](diagrams/helm-resource-map.md) and the [NetworkPolicy map](diagrams/network-policies.md)) |
| [ai-integration.md](ai-integration.md) | LLM provider abstraction, model choice (the spike), key setup, quotas, failures, switching providers | Available (Phase 4; the guardrails: scope rule, topic check, answer cap and daily budget, from Phase 5b) |
| [error-handling.md](error-handling.md) | Failure scenarios, retries, timeouts, fallbacks, user-facing errors | Available (final: the gateway, the upstreams and Postgres, the chat and the dashboard, and one table of every API error code and its HTTP status) |
| [security.md](security.md) | Authentication, authorization, secrets, input validation, hardening | Available (credentials, auth, CSRF, SSRF, logging, roles, residual risks; browser headers, the chat acting as the user, prompt injection, LLM keys; NetworkPolicies, Pod Security, the loopback-only cluster, production TLS and secrets; the external store; the Helm release Secret note. The short [threat model](threat-model.md) is its own note) |
| [testing.md](testing.md) | Test strategy, commands and verification procedures | Available (final: 671 tests, every check script with what it covers, a coverage statement and the known gaps) |
| [decisions/](decisions/README.md) | Architecture decision records (ADR-001 to ADR-020) | Available |
| [troubleshooting.md](troubleshooting.md) | Common development, configuration and deployment problems with fixes | Available (store problems from Phase 1, MCP server problems from Phase 2, gateway and Postgres problems from Phase 3, dashboard and chat problems from Phase 4, then the Phase 5 layers, the chat budget and topic check, and the external store) |
| [deployment.md](deployment.md) | Beginner-friendly deployment guide (local k3d and k3s on a VPS) | Available (local k3d from Phase 1, image build and MCP server from Phase 2, gateway and Postgres from Phase 3, dashboard and the AI key Secret from Phase 4; the k3s VPS section from Phase 5, rehearsed on a second k3d cluster, not run on a real VPS; a store hosted elsewhere, in-cluster MCP servers and "When the public address changes" from Phase 5b) |
| [screenshots/](screenshots/) | Dashboard screenshots taken from the local cluster (no keys, links or passwords shown); retaken on 2026-10-23 by `scripts/dev/capture-screenshots.ps1`, shown in the [README](../README.md#5-screenshots-or-visual-demonstrations) | Available (Phase 4; refreshed in Phase 6 with the Team page added) |
| [system-design-and-tradeoffs.md](system-design-and-tradeoffs.md) | Short note: architecture choices, routing and failure handling, what changes for production, main trade-offs | Available |
| [threat-model.md](threat-model.md) | Short note: shared upstream credentials, why client tokens are not passed through, untrusted upstreams, what one member can do to another, residual risks (Helm release Secret, topic check, k3d API port) | Available |
| [demo-script.md](demo-script.md) | Definition-of-done demo in the assignment's order (store, chat as user A, external MCP client as user B, team and control, audit) with a traceability table; run live at API level on 2026-10-23, Claude Code left as the owner's live step | Available |
| [stand-out-items.md](stand-out-items.md) | Which stand-out items were done, partial or not attempted, with file pointers and honest limits | Available |
| [assignment-checklist.md](assignment-checklist.md) | Every mandatory requirement and definition-of-done bullet, where it is in the repository and how it was verified (with dates) | Available |
| [learning/](learning/00-setup-log.md) | Interview-prep primers: [setup log](learning/00-setup-log.md), [Kubernetes primer](learning/01-kubernetes-primer.md), [MCP protocol](learning/02-mcp-protocol.md), [the gateway](learning/03-gateway.md) (Phase 3, with captured traffic), [the chat agent](learning/04-chat-agent.md) (Phase 4, with a captured LLM exchange); each one is final for what it covers | Available |
| [superpowers/specs/](superpowers/specs/2026-10-18-mcp-gateway-design.md) | The approved design spec | Available |
| [superpowers/plans/](superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) | The phased implementation plan | Available |

The repository root [README.md](../README.md) is the beginner entry point: it follows the 22 sections in `CLAUDE.md`, a step-by-step [local setup](../README.md#11-complete-local-installation-and-setup), [how to place an order, connect an MCP client and use the chat](../README.md#4-main-workflows-and-how-the-application-works), and a [VPS summary](../README.md#18-deployment-instructions). Its "Links to Documentation" section points here.
