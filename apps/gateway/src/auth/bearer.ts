import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKeys, users } from '../db/schema.js';
import { sha256Hex } from '../security/crypto.js';
import { verifyInternalToken } from './internalToken.js';
import { getUser, toAuthUser, type AuthUser } from './users.js';

export type BearerAuthResult =
  | { ok: true; user: AuthUser; apiKeyId: string | null; source: 'mcp' | 'chat' }
  | { ok: false; reason: 'missing' | 'unknown' | 'revoked' | 'disabled' | 'expired'; userId: string | null; apiKeyId: string | null };

const API_KEY_PREFIX = 'ugw_';

const fail = (reason: Extract<BearerAuthResult, { ok: false }>['reason'], userId: string | null = null, apiKeyId: string | null = null): BearerAuthResult => ({
  ok: false,
  reason,
  userId,
  apiKeyId,
});

/**
 * One credential check for /mcp. `ugw_…` → API key by SHA-256 lookup (no cache, ADR-008), updating
 * last_used_at on success; anything else → the internal chat JWT (ADR-010), whose user is re-read so
 * a user disabled after minting is rejected. A bad signature, audience or issuer → 'unknown'.
 */
export async function authenticateBearer(db: Db, header: string | undefined, internalSecret: string, now: Date): Promise<BearerAuthResult> {
  if (header === undefined || header.trim().length === 0) return fail('missing');
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
  const token = match?.[1];
  if (token === undefined) return fail('unknown');

  if (token.startsWith(API_KEY_PREFIX)) {
    const [row] = await db
      .select({ keyId: apiKeys.id, revokedAt: apiKeys.revokedAt, user: users })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(eq(apiKeys.keyHash, sha256Hex(token)));
    if (!row) return fail('unknown');
    if (row.revokedAt !== null) return fail('revoked', row.user.id, row.keyId);
    if (row.user.disabledAt !== null) return fail('disabled', row.user.id, row.keyId);
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.keyId));
    return { ok: true, user: toAuthUser(row.user), apiKeyId: row.keyId, source: 'mcp' };
  }

  const verified = await verifyInternalToken(token, internalSecret, now);
  if ('error' in verified) return fail(verified.error === 'expired' ? 'expired' : 'unknown');
  const user = await getUser(db, verified.userId);
  if (!user) return fail('unknown');
  if (user.disabledAt !== null) return fail('disabled', user.id);
  return { ok: true, user: toAuthUser(user), apiKeyId: null, source: 'chat' };
}
