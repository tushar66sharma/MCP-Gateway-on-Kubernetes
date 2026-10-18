# ADR-010: Chat agent loops back through the real `/mcp` with a 5-minute internal token

## Status

Accepted

## Date

2026-10-18

## Context

The dashboard has a chat agent: an LLM tool loop that answers questions by calling the same tools external clients see. The assignment requires that it call tools through the gateway and act as the logged-in user. Everything the agent does must go through the same authentication, routing, timeout, size-limit and audit path as an external MCP client, so the chat cannot become a back door with different rules.

## Decision

- `POST /api/chat` (session cookie) mints a short-lived **internal token**: a JWT signed (HMAC) with `GATEWAY_INTERNAL_TOKEN_SECRET`, `sub` = user id, `aud` = `gateway-chat`, expiry 5 minutes.
- The agent then calls the gateway's own `/mcp` endpoint over HTTP loopback with `Authorization: Bearer <internal token>`, for both `tools/list` and `tools/call`. `/mcp` accepts this token alongside API keys.
- Calls made this way are audited with `source=chat` and attributed to the real user.
- The token never leaves the server and is never sent to the browser or the LLM.
- Agent limits: at most 8 tool steps per turn, tool results truncated to 6,000 characters, and a 60s total turn timeout. Tool output is wrapped as untrusted data in the prompt.

## Alternatives considered

- **Call the internal tool-routing functions directly (no HTTP).** Rejected: it would create a second code path that could drift from `/mcp` in auth, tool visibility, limits and auditing, and the chat would stop being a faithful test of the real endpoint.
- **Give the chat agent a real stored API key per user.** Rejected: it creates long-lived hashed rows to clean up and shows up in users' key lists, when a 5-minute stateless token is enough.
- **A single service account with broad rights.** Rejected: it would lose per-user attribution and "acts as the user".

## Consequences/trade-offs

- One enforcement and audit path: anything true for external clients is true for chat, and the chat exercises `/mcp` end to end.
- Costs an extra in-process HTTP hop and the gateway must accept two kinds of bearer credentials, so the token validation (audience, expiry, signature) needs careful tests.
- `GATEWAY_INTERNAL_TOKEN_SECRET` becomes another sensitive secret in `gateway-secrets`.
- Internal tokens cannot be revoked individually; they simply expire after 5 minutes. The spec does not say whether a token for a user disabled mid-turn is rejected, so that must be decided and tested at implementation time.
- Not implemented yet; built in a later phase.

## Revisit if

- The gateway is split into separate processes where loopback no longer applies.
- We need per-conversation scoping of tools.
