import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { invites, users } from '../db/schema.js';
import { randomToken, sha256Hex } from '../security/crypto.js';
import { isUniqueViolation, toAuthUser, type AuthUser, type Role } from './users.js';

export const INVITE_TTL_MS = 72 * 3600 * 1000;

export interface InviteView {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  expired: boolean;
}

type InviteRow = typeof invites.$inferSelect;

export function toInviteView(i: InviteRow, now: Date): InviteView {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    expired: i.expiresAt.getTime() <= now.getTime(),
  };
}

/** `${PUBLIC_APP_URL}/invite/<token>`, without a doubled slash. */
export function inviteLink(publicAppUrl: string, token: string): string {
  return `${publicAppUrl.replace(/\/+$/, '')}/invite/${token}`;
}

/** The email must already be normalised. Only the token's SHA-256 is stored (ADR-013). */
export async function createInvite(db: Db, o: { email: string; role: Role; createdBy: string }, now: Date): Promise<{ invite: InviteRow; token: string }> {
  const token = randomToken(32);
  const [row] = await db
    .insert(invites)
    .values({ email: o.email, role: o.role, tokenHash: sha256Hex(token), createdBy: o.createdBy, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) })
    .returning();
  if (!row) throw new Error('invite insert returned no row');
  return { invite: row, token };
}

const usable = (now: Date) => and(isNull(invites.acceptedAt), gt(invites.expiresAt, now));

/** The invite for this token if it is neither used nor expired, else null (one answer for all three). */
export async function findUsableInvite(db: Db, token: string, now: Date): Promise<InviteRow | null> {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256Hex(token)), usable(now)));
  return row ?? null;
}

export type AcceptResult = { ok: true; user: AuthUser } | { ok: false; reason: 'invalid' | 'conflict' };

class EmailTaken extends Error {}

/**
 * Claims the invite and creates its user in one transaction. The claim is a conditional update, so two
 * concurrent accepts cannot both win; an existing user with the email rolls the claim back.
 */
export async function acceptInvite(db: Db, token: string, o: { name: string; passwordHash: string }, now: Date): Promise<AcceptResult> {
  try {
    return await db.transaction(async (tx): Promise<AcceptResult> => {
      const [claimed] = await tx
        .update(invites)
        .set({ acceptedAt: now })
        .where(and(eq(invites.tokenHash, sha256Hex(token)), usable(now)))
        .returning();
      if (!claimed) return { ok: false, reason: 'invalid' };
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, claimed.email));
      if (existing) throw new EmailTaken();
      const [user] = await tx.insert(users).values({ email: claimed.email, name: o.name, role: claimed.role, passwordHash: o.passwordHash }).returning();
      if (!user) throw new Error('user insert returned no row');
      return { ok: true, user: toAuthUser(user) };
    });
  } catch (err) {
    // Thrown inside the transaction so the claim rolls back; a racing insert surfaces as 23505.
    if (err instanceof EmailTaken || isUniqueViolation(err)) return { ok: false, reason: 'conflict' };
    throw err;
  }
}

/** Pending (not accepted) invites, expired ones included, newest first (no created_at: by expires_at). */
export async function listPendingInvites(db: Db, now: Date): Promise<InviteView[]> {
  const rows = await db.select().from(invites).where(isNull(invites.acceptedAt)).orderBy(desc(invites.expiresAt), desc(invites.id));
  return rows.map((r) => toInviteView(r, now));
}

/** Cancels a pending invite. False when there is no such pending invite. */
export async function deletePendingInvite(db: Db, id: string): Promise<boolean> {
  const deleted = await db
    .delete(invites)
    .where(and(eq(invites.id, id), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });
  return deleted.length > 0;
}
