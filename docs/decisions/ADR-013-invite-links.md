# ADR-013: Invite links instead of email or temporary passwords

## Status

Accepted

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
- Not implemented yet.

## Revisit if

- Email delivery is added (invites could then be sent automatically).
- Single sign-on or OAuth is introduced, replacing local passwords.
