import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { apiErrorHandler } from '../src/api/errors.js';
import { parseBody } from '../src/api/validate.js';
import { FixedWindowLimiter } from '../src/auth/rateLimit.js';
import { loadConfig } from '../src/config.js';
import { createUpstreamServices, sanitizeLogPath, startGateway } from '../src/server.js';
import { createTestDb } from './helpers/testDb.js';

function capture() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger('test', 'info', sink), lines };
}

describe('api error handler', () => {
  const app = express();
  app.use(express.json());
  app.post('/validate', (req, res) => {
    res.json(parseBody(z.object({ name: z.string() }), req.body));
  });
  app.get('/boom', () => {
    throw new Error('secret internal detail');
  });
  app.use(apiErrorHandler(createLogger('test', 'silent')));

  it('maps validation failures to 400 VALIDATION_FAILED with details.issues', async () => {
    const res = await request(app).post('/validate').send({ name: 5 });
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; details: { issues: { path: string }[] } } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.issues[0]?.path).toBe('name');
  });

  it('maps unknown errors to 500 INTERNAL without a stack or message', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect((res.body as { error: { code: string } }).error.code).toBe('INTERNAL');
    expect(res.text).not.toContain('secret internal detail');
    expect(res.text).not.toContain('at ');
  });
});

describe('request log path redaction', () => {
  let running: RunningMcpHttpServer | undefined;
  afterEach(async () => {
    await running?.close();
  });

  it('redacts invite tokens but leaves UUID paths unchanged', async () => {
    const { logger, lines } = capture();
    const db = await createTestDb();
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
    running = await startGateway(
      { config, logger, db, clock: () => new Date(), rateLimiter: new FixedWindowLimiter({ max: 10, windowMs: 60_000, clock: () => new Date() }), mcpAuthLimiter: new FixedWindowLimiter({ max: 30, windowMs: 60_000, clock: () => new Date() }), ...createUpstreamServices(config, logger, db), llm: null },
      { port: 0, host: '127.0.0.1' },
    );
    const base = `http://127.0.0.1:${running.port}`;
    const id = randomUUID();
    await request(base).get('/api/invites/SECRETTOKEN123?x=1');
    await request(base).get(`/api/invites/${id}`);
    // Express routes case-insensitively, so this reaches the invite route too.
    await request(base).get('/API/Invites/SECRETTOKEN456');
    await new Promise((r) => setTimeout(r, 50));
    await db.close();

    const all = lines.join('');
    expect(all).not.toContain('SECRETTOKEN123');
    expect(all).not.toContain('SECRETTOKEN456');
    const paths = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((o) => o.msg === 'request').map((o) => o.path);
    expect(paths).toContain('/api/invites/:token');
    expect(paths).toContain(`/api/invites/${id}`);
    expect(paths).toContain('/API/Invites/:token');
  });
});

describe('sanitizeLogPath', () => {
  it('redacts invite tokens in any case, and the /invite/<token> page path', () => {
    const id = randomUUID();
    expect(sanitizeLogPath('/api/invites/abc123/accept')).toBe('/api/invites/:token/accept');
    expect(sanitizeLogPath('/API/Invites/abc123')).toBe('/API/Invites/:token');
    expect(sanitizeLogPath(`/api/invites/${id}`)).toBe(`/api/invites/${id}`);
    expect(sanitizeLogPath('/invite/abc123')).toBe('/invite/:token');
    expect(sanitizeLogPath('/INVITE/abc123/x')).toBe('/INVITE/:token/x');
    expect(sanitizeLogPath('/api/servers/abc')).toBe('/api/servers/abc');
    expect(sanitizeLogPath('/invites')).toBe('/invites');
  });
});
