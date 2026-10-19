import { Writable } from 'node:stream';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { LoginRateLimiter } from '../src/auth/rateLimit.js';
import { loadConfig } from '../src/config.js';
import { connectWithRetry, type DbHandle } from '../src/db/client.js';
import { createUpstreamServices, startGateway } from '../src/server.js';
import * as schema from '../src/db/schema.js';
import { createTestDb } from './helpers/testDb.js';

const config = loadConfig({
  PUBLIC_APP_URL: 'http://app.localhost',
  GATEWAY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GATEWAY_INTERNAL_TOKEN_SECRET: 'x'.repeat(32),
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  BOOTSTRAP_ADMIN_PASSWORD: 'correct horse battery',
  PGHOST: 'localhost',
  PGDATABASE: 'gateway',
  PGUSER: 'gateway',
  PGPASSWORD: 'pw',
});

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  return { logger: createLogger('test', 'debug', sink), lines };
}

describe('gateway scaffold', () => {
  let handle: DbHandle;
  let running: RunningMcpHttpServer | undefined;

  beforeEach(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await running?.close();
    running = undefined;
    await handle.close();
  });

  const start = async (db: DbHandle) => {
    running = await startGateway(
      {
        config,
        logger: createLogger('test', 'silent'),
        db,
        clock: () => new Date(),
        rateLimiter: new LoginRateLimiter({ max: 10, windowMs: 60_000, clock: () => new Date() }),
        ...createUpstreamServices(config, createLogger('test', 'silent'), db),
      },
      { port: 0, host: '127.0.0.1' },
    );
    return `http://127.0.0.1:${running.port}`;
  };

  it('creates all six tables', async () => {
    for (const table of ['users', 'invites', 'sessions', 'api_keys', 'upstream_servers', 'audit_logs']) {
      const res = await handle.db.execute(sql.raw(`select count(*)::int as n from ${table}`));
      expect(((res as unknown as { rows: { n: number }[] }).rows[0]?.n)).toBe(0);
    }
  });

  it('round-trips credential_enc as a Buffer', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    await handle.db.insert(schema.upstreamServers).values({ slug: 'woo', name: 'Woo', url: 'http://x', authType: 'none', credentialEnc: bytes });
    const [row] = await handle.db.select().from(schema.upstreamServers);
    expect(Buffer.isBuffer(row?.credentialEnc)).toBe(true);
    expect(row?.credentialEnc?.equals(bytes)).toBe(true);
  });

  it('sets audit_logs.server_id to null when the server is deleted', async () => {
    const [srv] = await handle.db.insert(schema.upstreamServers).values({ slug: 'woo', name: 'Woo', url: 'http://x', authType: 'none' }).returning();
    await handle.db.insert(schema.auditLogs).values({ event: 'tool_call', source: 'mcp', serverId: srv?.id, serverSlug: 'woo', outcome: 'success' });
    await handle.db.delete(schema.upstreamServers);
    const [row] = await handle.db.select().from(schema.auditLogs);
    expect(row?.serverId).toBeNull();
    expect(row?.serverSlug).toBe('woo');
  });

  it('serves /healthz and /readyz', async () => {
    const base = await start(handle);
    expect((await request(base).get('/healthz')).status).toBe(200);
    expect((await request(base).get('/readyz')).status).toBe(200);
  });

  it('answers /readyz 503 when the database does not ping', async () => {
    const base = await start({ ...handle, ping: async () => false });
    expect((await request(base).get('/readyz')).status).toBe(503);
  });

  it('returns the API error shape for unknown /api routes', async () => {
    const base = await start(handle);
    const res = await request(base).get('/api/nope');
    expect(res.status).toBe(404);
    const body = res.body as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(body.error.requestId);
  });

  it('answers 401 on /mcp without credentials', async () => {
    const base = await start(handle);
    const res = await request(base).post('/mcp').set('Host', 'localhost').send({});
    expect(res.status).toBe(401);
  });
});

describe('connectWithRetry', () => {
  const noSleep = async () => {};

  it('resolves after two failures', async () => {
    const { logger } = captureLogger();
    const h = await createTestDb();
    let calls = 0;
    const open = async () => {
      calls += 1;
      if (calls < 3) throw new Error('refused');
      return h;
    };
    const got = await connectWithRetry(open, { attempts: 5, delayMs: 1, logger, sleep: noSleep });
    expect(got).toBe(h);
    expect(calls).toBe(3);
    await h.close();
  });

  it('rejects after the last attempt without logging the connection string', async () => {
    const { logger, lines } = captureLogger();
    const secret = 'postgres://user:hunter2@db:5432/x';
    const open = async (): Promise<DbHandle> => {
      throw Object.assign(new Error(`connect failed ${secret}`), { code: 'ECONNREFUSED' });
    };
    await expect(connectWithRetry(open, { attempts: 3, delayMs: 1, logger, sleep: noSleep })).rejects.toThrow('database not ready after 3 attempts');
    expect(lines.filter((l) => l.level === 40)).toHaveLength(3);
    expect(JSON.stringify(lines)).not.toContain('hunter2');
  });
});
