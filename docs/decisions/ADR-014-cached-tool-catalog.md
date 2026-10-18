# ADR-014: Cached, health-checked tool catalog instead of live fan-out on `tools/list`

## Status

Accepted

## Date

2026-10-18

## Context

The gateway's `tools/list` must aggregate the tools of every registered upstream. The assignment requires that a slow or dead upstream does not break the others and that failures produce clear errors. If `tools/list` contacted each upstream live, its latency would be that of the slowest server, and one dead upstream would make every client's listing slow or failing.

## Decision

- The upstream manager keeps an MCP client per server and runs a **health loop every 15 seconds** per enabled server: `tools/list` with a **5 second timeout**.
  - Success: status `connected`, the tool cache is replaced, `last_error` cleared.
  - Failure: status `unreachable`, cached tools **dropped**, and a human-readable `last_error` recorded (`connection refused`, `timeout after 5000ms`, `HTTP 401 from upstream`, `DNS lookup failed`).
- A server with `enabled = false` is `disabled`: its client is closed and it is not checked.
- Gateway `tools/list` returns the cached tools of servers that are enabled **and** connected. It never contacts upstreams, so a dead or slow upstream adds zero listing latency.
- A connection-level failure during `tools/call` marks the server `unreachable` immediately, so its tools vanish from the next listing without waiting for the next tick.
- State is in memory per replica and mirrored to `upstream_servers.last_*` for the dashboard.

## Alternatives considered

- **Live fan-out on every `tools/list`.** Rejected: latency is bounded by the slowest upstream, a dead server needs a timeout on every listing, and it multiplies load on upstreams with every client request.
- **Cache with a TTL but no health state.** Rejected: dead servers' tools would keep appearing, and clients would call tools that cannot work; the dashboard also needs health status and reasons.
- **Never drop tools of unreachable servers.** Rejected: clients would see tools that fail, rather than a catalog that reflects what works.

## Consequences/trade-offs

- Listing is fast and isolated from upstream failures, and the same checks power the dashboard's status badges and error reasons.
- The catalog can be stale for up to one health interval (15s): a newly broken upstream may still be listed until the next check or failing call, and tool changes upstream appear on the next successful tick. Calls to a dead server still return a clear error (timeout 20s, `isError`).
- State is per replica, so multiple gateway replicas could briefly disagree; the demo runs one replica and this is documented.
- Health checks add constant background traffic (one `tools/list` per server per 15s) and each failed check costs up to 5s of a background task, not of any user request.
- Not implemented yet; verified later by integration tests with a healthy, a slow and a dead fake upstream.

## Revisit if

- Upstreams support list-changed notifications we can rely on, which would reduce polling.
- We run multiple gateway replicas that must share health state (for example through the database or a shared cache).
