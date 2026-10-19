import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { randomToken, sha256Hex } from '../security/crypto.js';
import { lockActiveUser, toAuthUser, type AuthUser } from './users.js';

export const SESSION_COOKIE = 'ugw_session';
export const SESSION_TTL_SEC = 12 * 3600;

/**
 * A fresh 32-byte base64url token; only its SHA-256 is stored. Null when the user is disabled (or gone)
 * at insert time: the user row is re-read under FOR UPDATE in the same transaction, so a disable that
 * races the login either commits first (seen here) or waits and then deletes this session.
 * Also sweeps every expired session, so rows of clients that never log out do not pile up.
 */
export async function createSession(db: Db, userId: string, now: Date): Promise<string | null> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveUser(tx, userId))) return null;
    await tx.delete(sessions).where(lt(sessions.expiresAt, now));
    const token = randomToken(32);
    await tx.insert(sessions).values({ tokenHash: sha256Hex(token), userId, expiresAt: new Date(now.getTime() + SESSION_TTL_SEC * 1000) });
    return token;
  });
}

/** The session's user, or null. An expired session is deleted when seen; a disabled user has no session. */
export async function findSessionUser(db: Db, token: string, now: Date): Promise<AuthUser | null> {
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({ sessionId: sessions.id, expiresAt: sessions.expiresAt, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  if (row.user.disabledAt !== null) return null;
  return toAuthUser(row.user);
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

/** Minimal Cookie header parser: first occurrence of a name wins; undecodable values are skipped. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length === 0 || out.has(name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out.set(name, decodeURIComponent(value));
    } catch {
      // Malformed percent-encoding: ignore this cookie.
    }
  }
  return out;
}

export function sessionTokenFrom(cookieHeader: string | undefined): string | null {
  const token = parseCookies(cookieHeader).get(SESSION_COOKIE);
  return token !== undefined && token.length > 0 ? token : null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
