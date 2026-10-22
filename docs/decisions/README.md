# Architecture Decision Records

An Architecture Decision Record (ADR) is a short document that captures one significant technical decision: the situation that forced a choice, what was chosen, what else was considered, and what the choice costs. ADRs are kept in version control so that, months later, anyone can see not just *what* the system does but *why* it was built that way. The source of truth for the overall design is [the design spec](../superpowers/specs/2026-10-18-mcp-gateway-design.md); each ADR zooms in on one choice from it.

ADRs here are written as decisions ("we use...", "we will..."). Whether a decision has been implemented is tracked by the implementation plan; once a phase has built a decision, its ADR says so in the Status (for example "Implemented in Phase 3") and gains an "As built" section with what was actually built and verified. Each ADR's Consequences section says what is still to be verified.

## Template

Every ADR is a file named `ADR-NNN-<kebab-slug>.md` with exactly these headings:

```markdown
# ADR-NNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-MMM

## Date
YYYY-MM-DD

## Context
The forces at play: the requirement, the constraints, the problem.

## Decision
What we chose, stated plainly.

## Alternatives considered
Each realistic option and why it was not chosen.

## Consequences/trade-offs
What gets easier, what gets harder, what we accept, what is still unverified.

## Revisit if
The concrete conditions under which this decision should be reopened.
```

Status values: **Proposed** means the direction is set but a named spike must confirm it (the ADR says which); **Accepted** means final for now.

## Superseding an ADR

ADRs are never deleted or rewritten to hide history. To change a decision:

1. Write a new ADR (next free number) that explains the new decision and why the old one no longer holds.
2. In the old ADR, change its Status to `Superseded by ADR-NNN` (linking the new file). Leave the rest of its text untouched.
3. Add the new ADR to the index below.

Small clarifications that do not change the decision (typos, a confirmed spike result on a *Proposed* ADR) may be edited in place; when a Proposed ADR is finalized, change its Status to Accepted and note the outcome in its Decision section.

## Index

| # | Title | Status | Link |
|---|---|---|---|
| 001 | TypeScript npm-workspaces monorepo | Accepted | [ADR-001](ADR-001-typescript-monorepo.md) |
| 002 | k3d locally / k3s in prod, Traefik ingress | Accepted | [ADR-002](ADR-002-k3d-k3s-traefik.md) |
| 003 | One Helm chart owning three namespaces, `resource-policy: keep` | Accepted | [ADR-003](ADR-003-single-helm-chart-three-namespaces.md) |
| 004 | Own MariaDB/Postgres templates instead of Bitnami charts | Accepted | [ADR-004](ADR-004-own-database-templates.md) |
| 005 | WooCommerce MCP to store via REST v3 + OAuth1 | Accepted (Phase 1 spike passed) | [ADR-005](ADR-005-woocommerce-rest-oauth1.md) |
| 006 | Tool naming `<slug>__<tool>`, immutable slugs, 64-char rule | Accepted, implemented in Phase 3 | [ADR-006](ADR-006-tool-naming-scheme.md) |
| 007 | MCP SDK v2 with `createMcpHandler` (modern + stateless legacy fallback) | Accepted (Phase 2 spike) | [ADR-007](ADR-007-mcp-sdk-version.md) |
| 008 | API keys: random + SHA-256, shown once | Accepted, implemented in Phase 3 | [ADR-008](ADR-008-api-key-hashing.md) |
| 009 | Upstream credentials AES-256-GCM at rest | Accepted, implemented in Phase 3 | [ADR-009](ADR-009-upstream-credential-encryption.md) |
| 010 | Chat agent loops back through the real `/mcp` (a fresh internal token per request) | Accepted; token and `/mcp` acceptance implemented in Phase 3, agent, loopback client and `POST /api/chat` in Phase 4 | [ADR-010](ADR-010-chat-agent-loopback.md) |
| 011 | LLM: one OpenAI-compatible adapter, Groq + OpenRouter; default model `openai/gpt-oss-120b` | Accepted, implemented in Phase 4 (default model decided by the spike) | [ADR-011](ADR-011-llm-provider-abstraction.md) |
| 012 | Deployment target is k3s on a VPS, not Vercel/Render | Accepted | [ADR-012](ADR-012-deployment-target-k3s-vps.md) |
| 013 | Invite links instead of email/temporary passwords | Accepted, implemented in Phase 3 | [ADR-013](ADR-013-invite-links.md) |
| 014 | Cached health-checked tool catalog | Accepted, implemented in Phase 3 | [ADR-014](ADR-014-cached-tool-catalog.md) |
| 015 | Dashboard served by its own unprivileged nginx pod, same origin as the API | Accepted, implemented in Phase 4 | [ADR-015](ADR-015-dashboard-served-by-nginx.md) |
| 016 | Default-deny NetworkPolicies with one explicit allow rule per flow | Accepted, implemented in Phase 5 (Task 5.3) | [ADR-016](ADR-016-default-deny-network-policies.md) |
| 017 | Pod Security Admission at `restricted` on the app namespaces, plus schema validation of hostnames | Accepted, implemented in Phase 5 (Task 5.4) | [ADR-017](ADR-017-pod-security-restricted.md) |
