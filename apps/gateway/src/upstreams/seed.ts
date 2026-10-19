import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Logger } from '@urumi/shared';
import type { SeedServer } from '../config.js';
import type { Db } from '../db/client.js';
import { seededSlugs, upstreamServers } from '../db/schema.js';
import { encryptSecret } from '../security/crypto.js';

export interface SeedResult {
  /** New rows. */
  inserted: string[];
  /** Seeded before (or present and marked now): left alone, including when an admin deleted the row. */
  skipped: string[];
  /** Subset of `skipped`: rows that existed before seeded_slugs did, recorded as seeded on this run. */
  marked: string[];
}

/**
 * Seeds each server once, ever (ruling I2). A slug is inserted only when it is in neither
 * upstream_servers nor seeded_slugs, and the slug is recorded in seeded_slugs in the same transaction,
 * so an admin's DELETE of a built-in server survives restarts (re-add it with POST /api/servers).
 * A row that already exists (an install from before seeded_slugs) is marked as seeded, never re-inserted
 * or overwritten, so admin edits survive too.
 * The credential comes from env[seed.credentialEnv] and is encrypted with aad = the new row id,
 * which is therefore generated here, before the insert.
 */
export async function seedUpstreams(db: Db, seeds: SeedServer[], env: NodeJS.ProcessEnv, encKey: Buffer, logger: Logger): Promise<SeedResult> {
  const result: SeedResult = { inserted: [], skipped: [], marked: [] };
  for (const seed of seeds) {
    const outcome = await db.transaction(async (tx) => {
      const [seeded] = await tx.select({ slug: seededSlugs.slug }).from(seededSlugs).where(eq(seededSlugs.slug, seed.slug));
      if (seeded) return 'skipped' as const;
      const [existing] = await tx.select({ id: upstreamServers.id }).from(upstreamServers).where(eq(upstreamServers.slug, seed.slug));
      if (existing) {
        await tx.insert(seededSlugs).values({ slug: seed.slug }).onConflictDoNothing();
        return 'marked' as const;
      }
      const id = randomUUID();
      const credential = seed.credentialEnv ? env[seed.credentialEnv] : undefined;
      let credentialEnc: Buffer | null = null;
      if (credential !== undefined && credential.length > 0) {
        credentialEnc = encryptSecret(credential, encKey, id);
      } else if (seed.credentialEnv !== undefined || seed.authType !== 'none') {
        // Names the variable, never a value.
        logger.warn({ slug: seed.slug, envVar: seed.credentialEnv ?? null }, 'seed server credential env var is missing or empty; inserted without a credential');
      }
      await tx.insert(upstreamServers).values({
        id,
        slug: seed.slug,
        name: seed.name,
        url: seed.url,
        authType: seed.authType,
        authHeaderName: seed.authType === 'header' ? (seed.authHeaderName ?? null) : null,
        credentialEnc,
        enabled: true,
      });
      await tx.insert(seededSlugs).values({ slug: seed.slug });
      return 'inserted' as const;
    });
    if (outcome === 'inserted') {
      result.inserted.push(seed.slug);
    } else {
      result.skipped.push(seed.slug);
      if (outcome === 'marked') result.marked.push(seed.slug);
    }
  }
  if (result.inserted.length > 0) logger.info({ inserted: result.inserted }, 'seeded upstream servers');
  if (result.marked.length > 0) logger.info({ marked: result.marked }, 'existing upstream servers recorded as seeded');
  return result;
}
