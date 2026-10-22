import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import request from 'supertest';
import { vi } from 'vitest';
import { createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { ensureBootstrapAdmin } from '../../src/auth/bootstrap.js';
import { FixedWindowLimiter } from '../../src/auth/rateLimit.js';
import { createUser as insertUser, type AuthUser, type Role } from '../../src/auth/users.js';
import type { LlmProvider } from '../../src/chat/llm/types.js';
import { loadConfig } from '../../src/config.js';
import { encryptSecret } from '../../src/security/crypto.js';
import { createUpstreamServices, startGateway, type GatewayDeps } from '../../src/server.js';
import type { UpstreamRecord } from '../../src/upstreams/connection.js';
import { createTestDb } from './testDb.js';

export const PUBLIC_APP_URL = 'http://app.localhost';
export const ORIGIN = PUBLIC_APP_URL;
export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'admin-password-123';
export const DEFAULT_PASSWORD = 'member-password-123';
export const INTERNAL_SECRET = 'i'.repeat(32);

export interface Harness {
  baseUrl: string;
  deps: GatewayDeps;
  loginAs(email: string, password: string): Promise<string /* cookie */>;
  createUser(o: { email: string; role: Role; password?: string; name?: string }): Promise<AuthUser>;
  /** Moves the injected clock (sessions, invites, rate limiter) forward. */
  advanceTime(ms: number): void;
  /** Every log line the gateway wrote, raw. */
  logs: string[];
  close(): Promise<void>;
}

/** Adds what the CSRF guard requires of a mutating /api request, plus an optional session cookie. */
export function csrf<T extends request.Test>(t: T, cookie?: string): T {
  t.set('Origin', ORIGIN).set('Content-Type', 'application/json');
  if (cookie !== undefined) t.set('Cookie', cookie);
  return t;
}

/** `ugw_session=<token>` from a response's Set-Cookie, or null. */
export function sessionCookieOf(res: request.Response): string | null {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  for (const c of list) {
    const pair = c.split(';')[0]?.trim() ?? '';
    if (pair.startsWith('ugw_session=') && pair.length > 'ugw_session='.length) return pair;
  }
  return null;
}

/**
 * PGlite + a started UpstreamManager (loopback allowed, so fake upstreams on 127.0.0.1 work) + startGateway
 * on port 0. Seeds admin@example.com / admin-password-123 unless seedAdmin is false. `env` overrides config.
 * `llm` is the chat provider (a scripted fake in tests); null (default) answers LLM_NOT_CONFIGURED.
 */
export async function startHarness(
  o: { seedAdmin?: boolean; upstreams?: UpstreamRecord[]; env?: Record<string, string>; llm?: LlmProvider | null } = {},
): Promise<Harness> {
  const db = await createTestDb();
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logs.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger('gateway-test', 'debug', sink);
  const config = loadConfig({
    PUBLIC_APP_URL,
    GATEWAY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    GATEWAY_INTERNAL_TOKEN_SECRET: INTERNAL_SECRET,
    BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    PGHOST: 'localhost',
    PGDATABASE: 'gateway',
    PGUSER: 'gateway',
    PGPASSWORD: 'pw',
    SSRF_ALLOW_LOOPBACK: 'true',
    ...o.env,
  });
  let offsetMs = 0;
  const clock = () => new Date(Date.now() + offsetMs);
  const { upstreams, audit, repo } = createUpstreamServices(config, logger, db);
  const deps: GatewayDeps = {
    config,
    logger,
    db,
    clock,
    rateLimiter: new FixedWindowLimiter({ max: 10, windowMs: 60_000, clock }),
    mcpAuthLimiter: new FixedWindowLimiter({ max: config.MCP_AUTH_FAILURE_LIMIT_PER_MIN, windowMs: 60_000, clock }),
    upstreams,
    audit,
    repo,
    llm: o.llm ?? null,
  };

  if (o.seedAdmin ?? true) await ensureBootstrapAdmin(db.db, config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD, logger);

  if (o.upstreams && o.upstreams.length > 0) {
    for (const u of o.upstreams) {
      const secret = u.auth.kind === 'bearer' ? u.auth.token : u.auth.kind === 'header' ? u.auth.value : '';
      await repo.insert({
        id: u.id,
        slug: u.slug,
        name: u.name,
        url: u.url,
        authType: u.auth.kind,
        authHeaderName: u.auth.kind === 'header' ? u.auth.header : null,
        credentialEnc: secret.length > 0 ? encryptSecret(secret, config.GATEWAY_ENCRYPTION_KEY, u.id) : null,
        enabled: u.enabled,
      });
    }
  }

  await upstreams.start();
  // The first check can time out when every test file competes for CPU. The interval is 15 s here, so
  // refresh any enabled upstream that is not connected yet instead of asserting on a cold catalog.
  const enabled = (o.upstreams ?? []).filter((u) => u.enabled).map((u) => u.id);
  if (enabled.length > 0) {
    await vi.waitFor(
      async () => {
        for (const id of enabled) if (upstreams.getState(id).status !== 'connected') await upstreams.refresh(id);
        for (const id of enabled) if (upstreams.getState(id).status !== 'connected') throw new Error(`upstream ${id} not connected yet`);
      },
      { timeout: 10_000, interval: 50 },
    );
  }
  const running: RunningMcpHttpServer = await startGateway(deps, { port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${running.port}`;

  return {
    baseUrl,
    deps,
    logs,
    advanceTime: (ms) => {
      offsetMs += ms;
    },
    loginAs: async (email, password) => {
      const res = await csrf(request(baseUrl).post('/api/auth/login')).send({ email, password });
      const cookie = sessionCookieOf(res);
      if (res.status !== 200 || cookie === null) throw new Error(`login failed with HTTP ${res.status}`);
      return cookie;
    },
    createUser: (u) =>
      insertUser(db.db, {
        email: u.email,
        role: u.role,
        name: u.name ?? `User ${randomUUID().slice(0, 8)}`,
        password: u.password ?? DEFAULT_PASSWORD,
      }),
    close: async () => {
      await upstreams.stop();
      await running.close();
      await db.close();
    },
  };
}
