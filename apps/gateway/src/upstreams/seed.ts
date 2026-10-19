import { randomUUID } from 'node:crypto';
import type { Logger } from '@urumi/shared';
import type { SeedServer } from '../config.js';
import { encryptSecret } from '../security/crypto.js';
import type { UpstreamRepository } from './repository.js';

/**
 * Insert-if-absent by slug: a seed never overwrites a row, so admin edits survive restarts.
 * The credential comes from env[seed.credentialEnv] and is encrypted with aad = the new row id,
 * which is therefore generated here, before the insert.
 */
export async function seedUpstreams(
  repo: UpstreamRepository,
  seeds: SeedServer[],
  env: NodeJS.ProcessEnv,
  encKey: Buffer,
  logger: Logger,
): Promise<{ inserted: string[]; skipped: string[] }> {
  const inserted: string[] = [];
  const skipped: string[] = [];
  for (const seed of seeds) {
    if (await repo.getBySlug(seed.slug)) {
      skipped.push(seed.slug);
      continue;
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
    await repo.insert({
      id,
      slug: seed.slug,
      name: seed.name,
      url: seed.url,
      authType: seed.authType,
      authHeaderName: seed.authType === 'header' ? (seed.authHeaderName ?? null) : null,
      credentialEnc,
      enabled: true,
    });
    inserted.push(seed.slug);
  }
  if (inserted.length > 0) logger.info({ inserted }, 'seeded upstream servers');
  return { inserted, skipped };
}
