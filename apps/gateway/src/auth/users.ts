import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKeys, sessions, users, type User } from '../db/schema.js';
import { hashPassword } from '../security/passwords.js';

export type Role = 'admin' | 'member';
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface UserView extends AuthUser {
  disabled: boolean;
  createdAt: string;
}

/** Emails are trimmed and lowercased everywhere (Review Focus 4). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toAuthUser(u: Pick<User, 'id' | 'email' | 'name' | 'role'>): AuthUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export function toUserView(u: User): UserView {
  return { ...toAuthUser(u), disabled: u.disabledAt !== null, createdAt: u.createdAt.toISOString() };
}

/** Postgres unique_violation, raw or wrapped by Drizzle's query error. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e !== null && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return row ?? null;
}

/** A transaction handle (drizzle's `tx`), or the database itself. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Inside a transaction: locks the user row (SELECT … FOR UPDATE) and says whether the user exists and
 * is not disabled. updateUser's disable then waits for this transaction, or this one sees the disable.
 */
export async function lockActiveUser(tx: DbOrTx, id: string): Promise<boolean> {
  const [row] = await tx.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, id)).for('update');
  return row !== undefined && row.disabledAt === null;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export function listUsers(db: Db): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.createdAt), asc(users.email));
}

export async function createUser(db: Db, o: { email: string; name: string; role: Role; password: string }): Promise<AuthUser> {
  const passwordHash = await hashPassword(o.password);
  const [row] = await db.insert(users).values({ email: normalizeEmail(o.email), name: o.name, role: o.role, passwordHash }).returning();
  if (!row) throw new Error('user insert returned no row');
  return toAuthUser(row);
}

/**
 * Role change and/or disable/enable, in one transaction. Disabling also deletes every session and
 * revokes every key of the user (ADR-008); enabling clears disabled_at only, so keys stay revoked.
 */
export async function updateUser(db: Db, id: string, patch: { role?: Role; disabled?: boolean }, now: Date): Promise<User | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, id));
    if (!current) return null;
    const set: Partial<Pick<User, 'role' | 'disabledAt'>> = {};
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.disabled === true) set.disabledAt = current.disabledAt ?? now;
    if (patch.disabled === false) set.disabledAt = null;
    const [row] = Object.keys(set).length > 0 ? await tx.update(users).set(set).where(eq(users.id, id)).returning() : [current];
    if (patch.disabled === true) {
      await tx.delete(sessions).where(eq(sessions.userId, id));
      // Already-revoked keys keep their original revoked_at.
      await tx
        .update(apiKeys)
        .set({ revokedAt: now })
        .where(and(eq(apiKeys.userId, id), isNull(apiKeys.revokedAt)));
    }
    return row ?? null;
  });
}
