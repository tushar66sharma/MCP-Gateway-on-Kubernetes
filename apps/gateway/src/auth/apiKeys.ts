import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { generateApiKey } from '../security/crypto.js';

export interface KeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type KeyRow = typeof apiKeys.$inferSelect;

export function toKeyView(k: KeyRow): KeyView {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
  };
}

/** Stores only SHA-256(plaintext) and the display prefix (ADR-008); the plaintext is returned once. */
export async function createApiKey(db: Db, o: { userId: string; createdBy: string; name: string }, now: Date): Promise<{ key: KeyView; plaintext: string }> {
  const { plaintext, prefix, hash } = generateApiKey();
  const [row] = await db.insert(apiKeys).values({ userId: o.userId, createdBy: o.createdBy, name: o.name, prefix, keyHash: hash, createdAt: now }).returning();
  if (!row) throw new Error('api key insert returned no row');
  return { key: toKeyView(row), plaintext };
}

/** All keys of a user, revoked ones included, newest first. */
export async function listApiKeys(db: Db, userId: string): Promise<KeyView[]> {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  return rows.map(toKeyView);
}

/**
 * Revokes a key of `userId`. True when the key belongs to that user (revoking an already revoked key
 * keeps its first revoked_at); false when it does not exist or belongs to someone else.
 */
export async function revokeApiKey(db: Db, userId: string, keyId: string, now: Date): Promise<boolean> {
  const mine = and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId));
  await db.update(apiKeys).set({ revokedAt: now }).where(and(mine, isNull(apiKeys.revokedAt)));
  const [row] = await db.select({ id: apiKeys.id }).from(apiKeys).where(mine);
  return row !== undefined;
}
