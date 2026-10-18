# ADR-009: Upstream credentials encrypted with AES-256-GCM at rest, key in a Kubernetes Secret

## Status

Accepted

## Date

2026-10-18

## Context

Admins register upstream MCP servers in the dashboard, optionally with a static credential (a bearer token or a custom header value). The gateway must send that credential to the upstream on every call, so unlike API keys it must be recoverable in plaintext. The credential must never reach the browser or MCP clients. Admins also need to edit and rotate credentials at runtime, so the dashboard database must be the source of truth.

## Decision

- The credential is stored in `upstream_servers.credential_enc` as `AES-256-GCM(nonce ‖ ciphertext ‖ tag)`.
- The key is `GATEWAY_ENCRYPTION_KEY` (32 random bytes, base64), stored in Secret `gateway-secrets`, never in values files or Git.
- The API only ever returns `hasCredential: boolean`. Editing a server without supplying a credential keeps the existing one; an empty value with `clearCredential: true` removes it.
- The credential is decrypted only when the MCP client for that upstream is built, held in memory, and attached as a header. pino redaction covers `authorization`, `x-*-key` and `credential`.
- Credential Secrets in the `gateway` namespace are used only to **seed** servers (upsert by slug if absent); after that the encrypted column is the source of truth.
- Per the spec, the client's gateway key is never forwarded upstream (no token passthrough).

## Alternatives considered

- **One-way hash.** Impossible: the gateway needs the plaintext to authenticate to the upstream.
- **Plaintext in Postgres.** Rejected: a database dump or backup would expose every upstream credential.
- **Only Kubernetes Secrets, referenced by name.** Rejected as the primary store: admins could not add or rotate credentials from the dashboard without cluster access. Secrets are used for seeding and for the encryption key.
- **External KMS or Vault.** Not in scope for this project; it would add external infrastructure outside the single chart. The AES-GCM envelope is a clear place to plug one in.

## Consequences/trade-offs

- A leaked database dump or backup alone does not reveal credentials.
- The protection is only as strong as the key's secrecy: anyone with both the Secret and the database can decrypt. The design does not claim more.
- Losing `GATEWAY_ENCRYPTION_KEY` makes stored credentials unreadable; admins must re-enter them. Key rotation (re-encrypting rows) is not part of the current design.
- GCM requires a unique nonce per encryption; each write generates a fresh random nonce. Tampered ciphertext fails authentication on decrypt.
- Implemented and unit-tested (round trip) in a later phase.

## Revisit if

- We need key rotation, multiple keys or an external KMS.
- Compliance or a multi-tenant requirement demands per-server key separation.
