import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKeys, users } from '../db/schema.js';
import { sha256Hex } from '../security/crypto.js';
import { verifyInternalToken } from './internalToken.js';
import { getUser, toAuthUser, type AuthUser } from './users.js';

export type BearerAuthResult =
  | { ok: true; user: AuthUser; apiKeyId: string | null; source: 'mcp' | 'chat' }
  | {
      ok: false;
      reason: 'missing' | 'unknown' | 'revoked' | 'disabled' | 'expired';
      userId: string | null;
      apiKeyId: string | null;
      /**
       * A credential the gateway can recognise (spec §6.8 audits rejections "when the key is
       * recognizable"): a well-formed `ugw_` key, whatever its outcome, or an internal token whose
       * signature verified (expired, or its user disabled or gone). Anything else is noise.
       */
      recognised: boolean;
      /** The audit source: 'chat' for an internal token, else 'mcp'. */
      source: 'mcp' | 'chat';
    };

type Rejection = Extract<BearerAuthResult, { ok: false }>;

/** ADR-008: `ugw_` + 43 base62 characters. */
const API_KEY_RE = /^ugw_[0-9A-Za-z]{43}$/;
const API_KEY_PREFIX = 'ugw_';

function fail(
  reason: Rejection['reason'],
  o: { userId?: string | null; apiKeyId?: string | null; recognised?: boolean; source?: 'mcp' | 'chat' } = {},
): BearerAuthResult {
  return { ok: false, reason, userId: o.userId ?? null, apiKeyId: o.apiKeyId ?? null, recognised: o.recognised ?? false, source: o.source ?? 'mcp' };
}

/**
 * One credential check for /mcp. `ugw_…` → API key by SHA-256 lookup (no cache, ADR-008), updating
 * last_used_at on success; anything else → the internal chat JWT (ADR-010), whose user is re-read so
 * a user disabled after minting is rejected. A bad signature, audience or issuer → 'unknown'.
 * A disabled user is reported before a revoked key (disabling revokes every key, and 'user disabled'
 * is the more useful audit reason).
 */
export async function authenticateBearer(db: Db, header: string | undefined, internalSecret: string, now: Date): Promise<BearerAuthResult> {
  if (header === undefined || header.trim().length === 0) return fail('missing');
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
  const token = match?.[1];
  if (token === undefined) return fail('unknown');

  if (token.startsWith(API_KEY_PREFIX)) {
    // A malformed ugw_ value cannot be a key: no lookup, not recognisable.
    if (!API_KEY_RE.test(token)) return fail('unknown');
    const [row] = await db
      .select({ keyId: apiKeys.id, revokedAt: apiKeys.revokedAt, user: users })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(eq(apiKeys.keyHash, sha256Hex(token)));
    if (!row) return fail('unknown', { recognised: true });
    const owner = { userId: row.user.id, apiKeyId: row.keyId, recognised: true };
    if (row.user.disabledAt !== null) return fail('disabled', owner);
    if (row.revokedAt !== null) return fail('revoked', owner);
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.keyId));
    return { ok: true, user: toAuthUser(row.user), apiKeyId: row.keyId, source: 'mcp' };
  }

  const verified = await verifyInternalToken(token, internalSecret, now);
  if ('error' in verified) {
    if (verified.error === 'invalid') return fail('unknown');
    // Expired: the user id only if that user still exists (audit_logs.user_id references users).
    const user = verified.userId === null ? null : await getUser(db, verified.userId);
    return fail('expired', { userId: user?.id ?? null, recognised: true, source: 'chat' });
  }
  const user = await getUser(db, verified.userId);
  if (!user) return fail('unknown', { recognised: true, source: 'chat' });
  if (user.disabledAt !== null) return fail('disabled', { userId: user.id, recognised: true, source: 'chat' });
  return { ok: true, user: toAuthUser(user), apiKeyId: null, source: 'chat' };
}
