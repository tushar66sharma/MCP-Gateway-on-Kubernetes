# ADR-006: Tool naming `<slug>__<tool>`, immutable slugs, 64-char rule

## Status

Accepted. **Implemented in Phase 3** (2026-10-19).

## Date

2026-10-18

## Context

The gateway exposes tools from several upstream MCP servers through one `/mcp` endpoint. Two servers may define tools with the same name; we deliberately made `ping` exist on all three of our upstreams to show this. Clients must see unambiguous names, and the gateway must route each call back to the right server. Names must also be accepted by the strictest common client rule, which is the Claude Code / Anthropic API pattern `^[a-zA-Z0-9_-]{1,64}$`.

## Decision

- Every aggregated tool is named `<slug>__<original_tool_name>` (for example `woo__list_orders`, `notes__ping`, `utils__ping`).
- The slug is chosen by the admin, must match `^[a-z][a-z0-9-]{1,15}$`, must be unique, and is **immutable** after creation.
- A slug cannot contain a double underscore, so the gateway splits on the **first** `__` unambiguously.
- The full name must match `^[a-zA-Z0-9_-]{1,64}$`. An upstream tool whose prefixed name would break the rule is skipped and reported as a warning on that server's detail page.
- Each description is prefixed with `[<Server name>] `; the input schema is passed through unchanged.

## Alternatives considered

- **Namespacing with a separator like `.` or `/`.** Rejected: those characters are outside the strictest client name pattern.
- **Prefix only when a collision happens.** Rejected: a tool's name would change when another server is added or removed, silently breaking existing client configs and prompts.
- **Auto-generated server IDs as prefixes.** Rejected: unreadable to humans and to the model that has to pick the tool.
- **Allowing slug renames.** Rejected: renaming would silently break every client that uses the old names.
- **Rejecting colliding tools.** Rejected: it would make two legitimate servers unable to coexist.

## Consequences/trade-offs

- Names are stable, readable, collision-free by construction and cheap to route (split, look up the slug).
- The slug length cap (at most 16 characters) leaves room for the tool name within 64 characters, but a very long upstream tool name can still be skipped.
- Because slugs are immutable, fixing a bad slug means deleting and re-registering the server.
- The prefix costs a few tokens per tool in the model's context, relevant to the free-tier token limits (ADR-011).
- Unit-tested and exercised live (see "As built").

## As built (Phase 3)

- `apps/gateway/src/upstreams/naming.ts`: `SLUG_RE`, `TOOL_NAME_RE`, `toGatewayToolName` (returns null when the result breaks the 64-character rule) and `parseGatewayToolName` (splits on the **first** `__`; the tool part may itself contain `__`).
- A tool whose prefixed name is invalid is skipped **on its own**. The manager logs a warning and lists its upstream name in `skippedTools`, which the API returns on every `ServerView` (`GET /api/servers`). The server's other tools are still served. Pinned by the manager test "skips only the tool whose prefixed name is invalid".
- Slugs are immutable in the API: a `PATCH` containing `slug` is refused with `400 VALIDATION_FAILED` ("slug cannot be changed"). A slug that does not match `^[a-z][a-z0-9-]{1,15}$` is refused at creation; a duplicate is `409 CONFLICT`.
- The description prefix is `[<Server name>] `; with no upstream description the prefix stands alone. The input schema and the other tool metadata are passed through unchanged.
- Verified live (2026-10-19): the three `ping` tools coexist as `notes__ping`, `utils__ping` and `woo__ping`, and the 15 aggregated names match the pattern ([learning/03-gateway.md](../learning/03-gateway.md#51-toolslist-trimmed-from-15-tools-to-three)). The "warning on the server's detail page" is the `skippedTools` field, shown as a "skipped tools" warning on the dashboard's server page since Phase 4.

## Revisit if

- Target clients relax or change their name constraints.
- Admins need rename support with an alias mechanism, so old names keep working.
