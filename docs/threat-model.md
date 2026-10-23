# Threat model

A short note. Detail and evidence: [security.md](security.md). Labels: **tested** = pinned by an automated test; **live** = run on the local k3d cluster on the date given; **expected** = follows from the code, not run.

**Trust.** Admins are trusted (they register servers and read every audit row). Members are trusted with nothing beyond their own keys. Upstream MCP servers are **untrusted input**, even though an admin registered them. Anyone with `kubectl` access is trusted with everything.

## 1. Shared upstream credentials: what a member can do with a credential they never see

Each upstream has one static credential (bearer token, or a custom header for Utilities), encrypted with AES-256-GCM in `upstream_servers.credential_enc`, decrypted only inside the gateway to call that upstream, and never returned by the API, logged, or sent to a browser or client (**tested**; [security.md §1-2](security.md#1-two-credentials-that-never-meet)).

**What a member can do.** With their own key or in the chat, a member can call **every tool of every enabled server as the shared upstream identity**: create products, change order statuses and read every order with customer details (as the `urumi-mcp` user); create and delete notes; calculate. Nothing asks for confirmation.

**What a member cannot do.** Read, change or redirect the credential; register or edit a server (a stored credential is bound to its URL's origin, **tested**); call a disabled server.

**Limits on this power.**
- The **audit log** records user, server, tool, start, duration and outcome for every call. It stores no arguments, so it shows who called `update_order_status`, not for which order (**live**, 2026-10-23: [demo-script.md](demo-script.md#5-audit)).
- **Roles** are only `admin` and `member`; both can call every tool. **Per-tool permissions were not attempted** ([stand-out-items.md](stand-out-items.md)). The remedy today is disabling the user, which revokes their keys and sessions at once (**tested**).
- **The key owner is least privilege, not harmless.** The WooCommerce key belongs to a `shop_manager`, so a leaked key cannot install plugins, edit themes or manage users ([ADR-005](decisions/ADR-005-woocommerce-rest-oauth1.md)), but it can read and change products and orders.

## 2. Why client tokens are not passed through to upstream servers

The client's `ugw_` key is a credential for the **gateway**. The gateway authenticates to each upstream with that upstream's own credential and never forwards the client's. A test records every header a fake upstream receives and checks the key is absent (**tested**). Reasons:

- **Confused deputy.** An upstream holding the client's key could replay it against the gateway as that user.
- **Audience mismatch.** A key issued for the gateway is not a token issued for the upstream, and mixing audiences blurs who authenticated a request.
- **Revocation.** The gateway re-checks the key on every request and no upstream holds a copy, so nothing outlives revocation (**live**: the next call got `401`, 2026-10-23).
- **The MCP specification** (Security Best Practices, "Token Passthrough", read 2026-10-23) calls token passthrough an anti-pattern explicitly forbidden by the authorization specification: MCP servers "MUST NOT accept any tokens that were not explicitly issued for the MCP server". We follow that rule. Source: <https://modelcontextprotocol.io/specification/draft/basic/security_best_practices>.

The chat's internal token (HS256, audience `gateway-chat`, 5 minutes, minted per request) is accepted only by `/mcp` and never sent to the browser, the model or an upstream ([security.md §3, §11](security.md#3-authentication-and-sessions)).

## 3. Untrusted upstreams: tool descriptions written to manipulate the model

A compromised upstream controls its tool descriptions, schemas and results. The chat agent hardens what the model sees:
- descriptions are cut to **300 characters** (`TOOL_DESCRIPTION_MAX_CHARS`, `apps/gateway/src/chat/agent.ts`);
- each result is wrapped as `<tool_result name="…">`, cut to **6,000 characters**, and a result cannot close its own wrapper (**tested**);
- the system prompt says that text in results and descriptions is data, never instructions, and that data may change only when the user asked;
- a **scope rule** and an **on-topic check** by a small model before each turn stop casual misuse ([ADR-020](decisions/ADR-020-chat-guardrails.md)); a turn is bounded to 8 tool steps, 60 s and 1,024 answer tokens, a user to 50,000 tokens a day.

**What a malicious or compromised upstream can still do.**
- **Lie** in results and try to steer the model into calling another tool. That call runs with the user's rights and is audited, but there is **no human confirmation before a write** ([security.md §12](security.md#12-untrusted-data-and-prompt-injection)).
- **Exfiltrate the arguments it receives**, including text the model copied from other tools' results, to any public host (egress allows ports 80 and 443).
- It **cannot** read other servers' credentials or any client key (never sent to it), shadow another server's tools (every name carries its own slug), or break other servers (a bad tool name is skipped alone; a dead server costs only its own check).
- **External MCP clients get no gateway-side filtering:** descriptions and results reach them unchanged apart from a `[Server name] ` prefix.

**SSRF and NetworkPolicies.** An admin-supplied URL is checked on create, edit, every health check and at connect time: `http` or `https` only, no URL credentials, never loopback, link-local (cloud metadata) or unspecified, private ranges only for `*.mcp.svc.cluster.local`; redirects are not followed and DNS rebinding is closed (**tested**; refusals **live** 2026-10-19; [security.md §5](security.md#5-ssrf-guard)). Default-deny NetworkPolicies are the second layer: the gateway reaches only the MCP servers, Postgres, DNS and public addresses (13 of 13 probes, 2026-10-23; [security.md §15](security.md#15-networkpolicies-phase-5)).

## 4. What one team member can do to another

- **Keys:** cannot list, use or revoke yours (a foreign key id looks like `404`). An admin can issue a key for a member and use it; the calls are audited under that member.
- **Audit rows:** cannot read yours (`403`).
- **Users and invites:** invisible to members. The server list shows each URL and status, never a credential: do not put secrets in URLs.
- **Notes:** the notes server is shared; any member can read, change and delete anyone's notes (**no per-user isolation**; they live in memory).
- **Store data:** one store, no per-user filter; every member sees every order.
- **Chat:** nobody sees your conversation; it exists only in your browser tab and the request to the provider.
- **Budget:** the daily token budget and the 10 turns a minute are **per user**. All members share one provider key, so together they can still exhaust the free tier.

## 5. Other residual risks

- **Helm release Secret.** Helm keeps each release in a Secret `sh.helm.release.v1.urumi.vN` in `urumi-system` (base64 and gzip, not encrypted). With chart-generated Secrets the stored manifest holds every generated password and the encryption key: verified 2026-10-23 by decoding revision 24 and counting only, it holds 12 Secret manifests with `data`. Reading Secrets in `urumi-system` equals reading all credentials; old revisions can hold superseded values. In production, pre-create the Secrets with `scripts/prod/create-prod-secrets.sh` and restrict that namespace. Encrypting Secrets at rest is a k3s option **not** enabled or tested.
- **The topic check can be talked past** (a forged assistant turn in the client-supplied history); the scope rule, answer cap and daily budget bound the damage ([security.md §8, item 18](security.md#8-residual-risks)).
- **Also:** k3d publishes the Kubernetes API (6443) on all interfaces (ports 80 and 443 are loopback-only, **live** 2026-10-23); open registration is off in the production values, but fake guest orders remain possible ([security.md §8](security.md#8-residual-risks)).
