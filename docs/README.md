# Documentation map

This is the index of all project documentation. Status is honest: **Available** means the file exists in the repository today; **(planned)** means it has not been written yet and names the phase of the [implementation plan](superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) that will produce it. Planned documents have no placeholder files.

## How to read these docs

If you are new to the project, read in this order:

1. **The design spec:** [superpowers/specs/2026-10-18-mcp-gateway-design.md](superpowers/specs/2026-10-18-mcp-gateway-design.md). The source of truth for what we are building and why.
2. **To run the project:** [run-guide.md](run-guide.md). One command starts it; the guide explains every part.
3. **The architecture overview:** [architecture.md](architecture.md). The components, how they connect, and which namespaces they live in (target architecture; the store and the WooCommerce MCP server are built, the gateway and the other MCP servers are still planned).
4. **The Kubernetes primer:** [learning/01-kubernetes-primer.md](learning/01-kubernetes-primer.md). The Kubernetes concepts the project uses, each tied to a command you can run against the local cluster.
5. **The MCP protocol:** [learning/02-mcp-protocol.md](learning/02-mcp-protocol.md). What MCP is and how our server speaks it, with real captured requests and responses.
6. **The decision records:** [decisions/README.md](decisions/README.md). One short ADR per significant choice, with alternatives and trade-offs.

## Document index

| Document | Purpose | Status |
|---|---|---|
| [run-guide.md](run-guide.md) | **Start here to run things.** How to start, use, inspect and reset every part of the project, for Kubernetes beginners; grows each phase | Available (store from Phase 1 and the WooCommerce MCP server from Phase 2; gateway and dashboard sections are **(planned)**) |
| [architecture.md](architecture.md) | High-level architecture, components, responsibilities, technology choices | Available (store built in Phase 1 and the WooCommerce MCP server in Phase 2; other components are planned) |
| system-design.md | Detailed design: component interactions, data flow, interfaces, trade-offs | (planned) — Phase 3 (partial), Phase 6 (complete) |
| [workflows.md](workflows.md) | Step-by-step explanation of the major workflows | Available (store workflows from Phase 1 and the MCP tool call to the store from Phase 2; grows each phase, complete in Phase 6) |
| [diagrams/](diagrams/README.md) | Architecture, sequence, data-flow and workflow diagrams (Mermaid) | Available (index; store diagrams exist since Phase 1, MCP server diagrams since Phase 2, others are added per phase) |
| ai-integration.md | LLM provider abstraction, key setup, quotas, switching providers | (planned) — Phase 4 |
| error-handling.md | Failure scenarios, retries, timeouts, fallbacks, user-facing errors | (planned) — Phase 3 (partial), Phase 6 (complete) |
| security.md | Authentication, authorization, secrets, input validation, hardening | (planned) — Phase 3 (partial), Phase 6 (complete) |
| testing.md | Test strategy, commands and verification procedures | (planned) — Phase 6 |
| [decisions/](decisions/README.md) | Architecture decision records (ADR-001 to ADR-014) | Available |
| [troubleshooting.md](troubleshooting.md) | Common development, configuration and deployment problems with fixes | Available (store problems from Phase 1, MCP server problems from Phase 2; grows each phase, complete in Phase 6) |
| [deployment.md](deployment.md) | Beginner-friendly deployment guide (local k3d and k3s on a VPS) | Available (local k3d from Phase 1, image build and MCP server from Phase 2; the k3s VPS section is **(planned)** for Phase 5) |
| system-design-and-tradeoffs.md | Short note: architecture choices, routing and failure handling, what changes for production | (planned) — Phase 6 |
| threat-model.md | Short note: shared upstream credentials, token passthrough, malicious tool descriptions, compromised upstreams | (planned) — Phase 6 |
| demo-script.md | Step-by-step script for demonstrating the finished system | (planned) — Phase 5 |
| stand-out-items.md | Which stand-out items were done (with file pointers) and which were not attempted | (planned) — Phase 6 |
| [learning/](learning/00-setup-log.md) | Interview-prep primers: [setup log](learning/00-setup-log.md), [Kubernetes primer](learning/01-kubernetes-primer.md), [MCP protocol](learning/02-mcp-protocol.md); the gateway walkthrough and interview Q&A are (planned) — Phases 3 and 6 | Available (partial) |
| [superpowers/specs/](superpowers/specs/2026-10-18-mcp-gateway-design.md) | The approved design spec | Available |
| [superpowers/plans/](superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) | The phased implementation plan | Available |

The repository root [README.md](../README.md) is the beginner entry point; its "Links to Documentation" section points here.
