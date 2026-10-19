import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { createLogger } from '@urumi/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/db/client.js';
import { seededSlugs } from '../../src/db/schema.js';
import { decryptSecret } from '../../src/security/crypto.js';
import { UpstreamRepository } from '../../src/upstreams/repository.js';
import { seedUpstreams } from '../../src/upstreams/seed.js';
import { createTestDb } from '../helpers/testDb.js';

function captureLogger() {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { logger: createLogger('seed-test', 'debug', dest), lines };
}

const encKey = randomBytes(32);
const woo = { slug: 'woo', name: 'WooCommerce', url: 'http://mcp-woocommerce.mcp.svc.cluster.local:3001/mcp', authType: 'bearer' as const, credentialEnv: 'SEED_WOO_TOKEN' };
const WOO_ENV = { SEED_WOO_TOKEN: 'woo-token-value-123' };

describe('seedUpstreams', () => {
  let h: DbHandle;
  let repo: UpstreamRepository;
  beforeEach(async () => {
    h = await createTestDb();
    repo = new UpstreamRepository(h.db);
  });
  afterEach(async () => {
    await h.close();
  });

  const seeded = async () => (await h.db.select().from(seededSlugs)).map((r) => r.slug).sort();

  it('inserts a seed with its credential encrypted against the row id, and records the slug', async () => {
    const { logger } = captureLogger();
    const res = await seedUpstreams(h.db, [woo], WOO_ENV, encKey, logger);
    expect(res).toEqual({ inserted: ['woo'], skipped: [], marked: [] });
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.slug).toBe('woo');
    expect(row.authType).toBe('bearer');
    expect(row.credentialEnc).not.toBeNull();
    expect(decryptSecret(row.credentialEnc!, encKey, row.id)).toBe('woo-token-value-123');
    expect(await seeded()).toEqual(['woo']);
  });

  it('a second run inserts nothing and keeps admin edits', async () => {
    const { logger } = captureLogger();
    await seedUpstreams(h.db, [woo], WOO_ENV, encKey, logger);
    const row = (await repo.getBySlug('woo'))!;
    await repo.update(row.id, { name: 'Shop (edited)' });
    const res = await seedUpstreams(h.db, [woo], WOO_ENV, encKey, logger);
    expect(res).toEqual({ inserted: [], skipped: ['woo'], marked: [] });
    expect(await repo.list()).toHaveLength(1);
    expect((await repo.getBySlug('woo'))!.name).toBe('Shop (edited)');
  });

  it('a deleted seeded server is not re-created by the next run (restart)', async () => {
    const { logger } = captureLogger();
    await seedUpstreams(h.db, [woo], WOO_ENV, encKey, logger);
    expect(await repo.delete((await repo.getBySlug('woo'))!.id)).toBe(true);
    const res = await seedUpstreams(h.db, [woo], WOO_ENV, encKey, logger);
    expect(res).toEqual({ inserted: [], skipped: ['woo'], marked: [] });
    expect(await repo.list()).toEqual([]);
    expect(await seeded()).toEqual(['woo']);
  });

  it('marks a row that existed before seeded_slugs as seeded, without inserting a duplicate', async () => {
    const { logger } = captureLogger();
    // An install from before the table: the row is there, seeded_slugs is empty.
    const id = randomUUID();
    await repo.insert({ id, slug: 'woo', name: 'Shop (edited)', url: woo.url, authType: 'none', authHeaderName: null, credentialEnc: null, enabled: false });
    const notes = { slug: 'notes', name: 'Notes', url: 'http://mcp-notes.mcp.svc.cluster.local:3002/mcp', authType: 'none' as const };
    const res = await seedUpstreams(h.db, [woo, notes], WOO_ENV, encKey, logger);
    expect(res).toEqual({ inserted: ['notes'], skipped: ['woo'], marked: ['woo'] });
    expect((await repo.list()).map((r) => r.slug)).toEqual(['notes', 'woo']);
    // Untouched: same id, admin edits kept, no credential added.
    expect(await repo.getBySlug('woo')).toMatchObject({ id, name: 'Shop (edited)', authType: 'none', credentialEnc: null, enabled: false });
    expect(await seeded()).toEqual(['notes', 'woo']);
    // From now on a delete is final.
    await repo.delete(id);
    expect((await seedUpstreams(h.db, [woo, notes], WOO_ENV, encKey, logger)).inserted).toEqual([]);
    expect((await repo.list()).map((r) => r.slug)).toEqual(['notes']);
  });

  it.each([
    ['missing', {}],
    ['empty', { SEED_X: '' }],
  ])('inserts without a credential and warns naming the env var when it is %s', async (_label, env: NodeJS.ProcessEnv) => {
    const { logger, lines } = captureLogger();
    const seed = { slug: 'x-server', name: 'X', url: 'http://x.mcp.svc.cluster.local/mcp', authType: 'header' as const, authHeaderName: 'x-api-key', credentialEnv: 'SEED_X' };
    const res = await seedUpstreams(h.db, [seed], env, encKey, logger);
    expect(res.inserted).toEqual(['x-server']);
    const row = (await repo.getBySlug('x-server'))!;
    expect(row.credentialEnc).toBeNull();
    expect(row.authHeaderName).toBe('x-api-key');
    const warns = lines.map((l) => JSON.parse(l) as { level: number; msg: string }).filter((l) => l.level === 40);
    expect(warns).toHaveLength(1);
    expect(JSON.stringify(warns[0])).toContain('SEED_X');
  });

  it('never logs the credential value', async () => {
    const { logger, lines } = captureLogger();
    await seedUpstreams(h.db, [woo], WOO_ENV, encKey, logger);
    expect(lines.join('\n')).not.toContain('woo-token-value-123');
  });
});
