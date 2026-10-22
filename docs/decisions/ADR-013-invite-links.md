# ADR-013: Invite links instead of email or temporary passwords

## Status

Accepted. **Implemented in Phase 3** (2026-10-19); the web page for the link (`/invite/<token>`) and the Team page were built in Phase 4.

## Date

2026-10-18

## Context

The gateway has two roles, admin and member. An admin must be able to bring teammates in. The first admin is bootstrapped from `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (Secret `gateway-bootstrap`) when the `users` table is empty. For everyone else we need an onboarding flow that does not require an email server (out of scope: email delivery) and that avoids an admin ever knowing a member's password.

## Decision

- An admin enters an email and a role. The gateway creates an invite with a random token, stores only its SHA-256 hash (`invites.token_hash`), and shows the link **once** to the admin: `${PUBLIC_APP_URL}/invite/<token>` (`http://app.localhost` locally, `https://app.<domain>` in production).
- The admin delivers the link out of band (chat, email client, in person).
- The invite is valid for **72 hours** and **single-use**. The invitee opens the link, sets their name and a password (minimum 10 characters, stored with argon2id), and the invite is marked accepted. Admins can list and cancel pending invites.
- The public endpoints are `GET /api/invites/:token` and `POST /api/invites/:token/accept`; the admin endpoints are `GET/POST /api/invites` and `DELETE /api/invites/:id`.

## Alternatives considered

- **Email delivery of invites.** Rejected: it needs SMTP or a mail provider, secrets and deliverability handling, which are out of scope and not reliably free.
- **Admin-created account with a temporary password.** Rejected: the admin knows the member's password, it has to be shared through some channel anyway, and it needs a forced-change flow to be acceptable.
- **Open self-signup.** Rejected: anyone who can reach the dashboard could join a team gateway that exposes company tools.

## Consequences/trade-offs

- No external dependency for onboarding, and the admin never sees a member's password.
- The link is a bearer secret until used or expired: anyone who obtains it within 72 hours can claim the account. Mitigations are single use, short expiry and storing only the hash; the admin is responsible for sending it over a reasonable channel.
- If the admin loses the link it cannot be re-displayed; they cancel and create a new invite.
- The link depends on `PUBLIC_APP_URL` being correct for each environment (including a non-default local port).
- Implemented and tested (see "As built"); the dashboard's invite page was added in Phase 4 ([workflow 13](../workflows.md#13-accept-an-invite-in-the-browser)). It sends `Referrer-Policy: no-referrer`; the dashboard's nginx access log, unlike the gateway's request log, records the page path with its token ([security.md](../security.md#8-residual-risks), risk 13).

## As built (Phase 3)

- Endpoints exactly as listed in the Decision. `POST /api/invites` returns `201 {invite, link}`; the link is `${PUBLIC_APP_URL}/invite/<token>` where the token is 32 random bytes in base64url (43 characters). It is not logged. Only `SHA-256(token)` is stored.
- Emails are trimmed and lowercased. Inviting an email that already has an account (in any letter case) is `409 CONFLICT`.
- Validity 72 h and single use. `POST /api/invites/:token/accept` does a cheap lookup first (a random token never costs an argon2 hash), then claims the invite with a conditional update and creates the user in **one transaction**; an existing user with that email rolls the claim back (`409`). The new user gets a session cookie straight away. Unknown, expired, used and cancelled tokens all answer `404 INVITE_INVALID`.
- The mutating invite routes, public ones included, are behind the CSRF rule (`Origin` + `Content-Type: application/json`).
- **`invites` has no `created_at`** (the spec lists none), so `GET /api/invites` lists pending invites (expired ones included, flagged `expired`) ordered by `expires_at`, newest first.
- **Log redaction:** the request log writes `/api/invites/:token` for the invite paths (taken from the original URL, so the mounted router's stripped prefix cannot defeat it); a UUID path (`DELETE /api/invites/<id>`) is kept. The match is case-insensitive, like Express routing (`/API/Invites/<token>` is redacted too), and `/invite/<token>`, the Phase 4 dashboard's invite page, is logged as `/invite/:token` (tested).
- Verified live (2026-10-19): create, list, preview, cancel (`204`), then `404 INVITE_INVALID` on the cancelled link. The accept step is covered by `test/api/invites.test.ts` and was not run on the cluster, to avoid leaving a test user.

## Revisit if

- Email delivery is added (invites could then be sent automatically).
- Single sign-on or OAuth is introduced, replacing local passwords.
