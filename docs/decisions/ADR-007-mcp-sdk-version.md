# ADR-007: MCP SDK v2 with stateless Streamable HTTP, v1 as fallback

## Status

Proposed. Finalized in Phase 2 after the compatibility gate (first hour of Phase 2) shows that MCP Inspector and Claude Code can list and call tools against a v2 server.

## Date

2026-10-18

## Context

The MCP TypeScript SDK has two lines, verified against official sources on 2026-10-18:

- **v2**: `@modelcontextprotocol/server` and `@modelcontextprotocol/client` (2.3.1), implementing the **2026-07-28** spec, where Streamable HTTP is stateless.
- **v1**: `@modelcontextprotocol/sdk` (1.32.1), still maintained, with optional stateful sessions.

Our gateway is both an MCP client (to upstreams) and an MCP server (to clients), and all our own MCP servers use the same SDK. The risk is that some client we need to support (Claude Code, MCP Inspector, Cursor) may not yet speak the newer protocol.

## Decision

- **Default: v2**, with stateless Streamable HTTP. Every MCP server exposes `POST /mcp` for JSON-RPC, plus `GET /healthz` (liveness) and `GET /readyz` (readiness).
- **Compatibility gate:** at the start of Phase 2 we confirm that MCP Inspector and Claude Code can list and call tools against a v2 server.
- **If either fails:** switch every component to **v1 in stateless mode** (`sessionIdGenerator: undefined`), which works with older clients. The outcome and date are recorded in this ADR, which then becomes Accepted.

## Alternatives considered

- **v1 from the start.** Safe for clients, but it is the older line; we would choose it only if the gate fails. Starting on v2 avoids a later migration if the gate passes.
- **v1 with stateful sessions.** Rejected: sessions need affinity or shared state across gateway replicas, which stateless operation avoids.
- **Mixing versions per component.** Rejected: more moving parts, and the shared bootstrap in `packages/shared` should use one SDK.

## Consequences/trade-offs

- Stateless transport suits a gateway: no session affinity and nothing to share between replicas. State in the design (sessions, keys) lives in Postgres, not in MCP sessions.
- Newer SDK means less community material and possible rough edges; the gate limits that risk to one decision point early.
- If we fall back, the choice is contained because both options use the same endpoint shape and the shared bootstrap in `packages/shared` hides the SDK.
- Nothing is implemented yet; this decision is not final until the gate result is recorded.

## Revisit if

- The gate fails (switch to v1 stateless and update this ADR).
- Claude Code or Inspector drop v1 support, or v1 is no longer maintained.
