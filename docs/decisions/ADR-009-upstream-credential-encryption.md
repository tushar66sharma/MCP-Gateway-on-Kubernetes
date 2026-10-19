# ADR-009: Upstream credentials encrypted with AES-256-GCM at rest, key in a Kubernetes Secret

## Status

Accepted. **Implemented in Phase 3** (2026-10-19).

## Date

2026-10-18

## Context

Admins register upstream MCP servers in the dashboard, optionally with a static credential (a bearer token or a custom header value). The gateway must send that credential to the upstream on every call, so unlike API keys it must be recoverable in plaintext. The credential must never reach the browser or MCP clients. Admins also need to edit and rotate credentials at runtime, so the dashboard database must be the source of truth.

## Decision

- The credential is stored in `upstream_servers.credential_enc` as `AES-256-GCM(nonce ‖ ciphertext ‖ tag)`.
- The key is `GATEWAY_ENCRYPTION_KEY` (32 random bytes, base64), stored in Secret `gateway-secrets`, never in values files or Git.
- The API only ever returns `hasCredential: boolean`. Editing a server without supplying a credential keeps the existing one; an empty value with `clearCredential: true` removes it.
- The credential is decrypted only when the MCP client for that upstream is built, held in memory, and attached as a header. pino redaction covers `authorization`, `x-*-key` and `credential`.
- Credential Secrets in the `gateway` namespace are used only to **seed** servers (each slug once, ever, if absent; a deleted built-in server is not re-created); after that the encrypted column is the source of truth.
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
- Implemented and unit-tested (see "As built").

## As built (Phase 3)

- **Blob layout:** `nonce(12) ‖ ciphertext ‖ tag(16)`. The nonce is **96 bits** (12 random bytes), fresh for every encryption.
- **AAD = the server row id.** `encryptSecret(plain, key, aad)` binds the blob to its row, so a ciphertext copied into another row fails to decrypt. The id is therefore generated **before** the insert (`randomUUID()` in the create route and in the seeder). Tests: round trip, every-byte tamper, wrong AAD, too-short input, a unique nonce each time; the 32-byte key rule is in the config tests.
- **The key:** `GATEWAY_ENCRYPTION_KEY` must be canonical base64 of exactly 32 bytes, checked at start (the pod exits naming the variable). Helm generates it with `randBytes 32` in Secret `gateway-secrets` (`resource-policy: keep`).
- **Seeding:** each seed slug is inserted once, ever: only when it is in neither `upstream_servers` nor the `seeded_slugs` table, which records it in the same transaction. An edited server is never overwritten, and a deleted built-in server stays deleted (re-add it with `POST /api/servers`). Credential from the env var the seed names; if that variable is missing, the row is inserted without a credential and a warning names the variable.
- **API:** `hasCredential` only; `credential` is accepted on create and `PATCH`, printable ASCII up to 4096 characters (so CR/LF is refused at the door and never echoed); omitted keeps the stored one, `clearCredential: true` removes it, and `authType: none` never keeps one. A test checks that the plaintext appears in no response, log or header of the whole server flow.
- **Decrypted only** when the connection for that upstream is built, held in memory, attached as one header. A malformed value that gets through (for example from a seed) is caught by a header check in the connection and reported without the value.
- **Connect-time address pinning.** Beyond the create/edit-time SSRF check, the connection uses an undici dispatcher with a checking DNS lookup, so the name is resolved and judged again when the socket opens; redirects are never followed. This closes DNS rebinding for the place where the credential is sent ([security.md](../security.md#5-ssrf-guard)).
- Verified live: all three stored credentials are 76 bytes (12 + 16 + a 48-character credential) and `GET /api/servers` shows `hasCredential` true and nothing else.
- **A credential is bound to its origin.** A `PATCH` that changes the URL's origin (scheme, host or port) of a server with a stored credential must re-enter the credential or send `clearCredential: true`, or it gets `400 VALIDATION_FAILED`; a path-only change keeps it (tested). So an admin cannot redirect a stored credential to another host without knowing it. Key rotation is still not built.

## Revisit if

- We need key rotation, multiple keys or an external KMS.
- Compliance or a multi-tenant requirement demands per-server key separation.
