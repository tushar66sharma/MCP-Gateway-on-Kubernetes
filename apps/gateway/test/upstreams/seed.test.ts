import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { createLogger } from '@urumi/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../../src/db/client.js';
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

  it('inserts a seed with its credential encrypted against the row id', async () => {
    const { logger } = captureLogger();
    const res = await seedUpstreams(repo, [woo], { SEED_WOO_TOKEN: 'woo-token-value-123' }, encKey, logger);
    expect(res).toEqual({ inserted: ['woo'], skipped: [] });
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.slug).toBe('woo');
    expect(row.authType).toBe('bearer');
    expect(row.credentialEnc).not.toBeNull();
    expect(decryptSecret(row.credentialEnc!, encKey, row.id)).toBe('woo-token-value-123');
  });

  it('is insert-if-absent: a second run inserts nothing and keeps admin edits', async () => {
    const { logger } = captureLogger();
    await seedUpstreams(repo, [woo], { SEED_WOO_TOKEN: 'woo-token-value-123' }, encKey, logger);
    const row = (await repo.getBySlug('woo'))!;
    await repo.update(row.id, { name: 'Shop (edited)' });
    const res = await seedUpstreams(repo, [woo], { SEED_WOO_TOKEN: 'woo-token-value-123' }, encKey, logger);
    expect(res).toEqual({ inserted: [], skipped: ['woo'] });
    expect(await repo.list()).toHaveLength(1);
    expect((await repo.getBySlug('woo'))!.name).toBe('Shop (edited)');
  });

  it.each([
    ['missing', {}],
    ['empty', { SEED_X: '' }],
  ])('inserts without a credential and warns naming the env var when it is %s', async (_label, env: NodeJS.ProcessEnv) => {
    const { logger, lines } = captureLogger();
    const seed = { slug: 'x-server', name: 'X', url: 'http://x.mcp.svc.cluster.local/mcp', authType: 'header' as const, authHeaderName: 'x-api-key', credentialEnv: 'SEED_X' };
    const res = await seedUpstreams(repo, [seed], env, encKey, logger);
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
    await seedUpstreams(repo, [woo], { SEED_WOO_TOKEN: 'woo-token-value-123' }, encKey, logger);
    expect(lines.join('\n')).not.toContain('woo-token-value-123');
  });
});
