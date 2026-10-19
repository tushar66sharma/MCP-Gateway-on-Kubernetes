import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { createLogger, type Logger, type UpstreamAuth } from '@urumi/shared';
import { and, eq, isNull, or } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditWriter } from '../../src/audit/writer.js';
import type { DbHandle } from '../../src/db/client.js';
import * as schema from '../../src/db/schema.js';
import { encryptSecret } from '../../src/security/crypto.js';
import type { SsrfOptions } from '../../src/security/ssrf.js';
import { UpstreamManager, type CallContext } from '../../src/upstreams/manager.js';
import { parseGatewayToolName } from '../../src/upstreams/naming.js';
import { UpstreamRepository, type UpstreamRow } from '../../src/upstreams/repository.js';
import { closedPort, startFakeUpstream, startRedirectServer, type FakeUpstream } from '../helpers/fakeUpstream.js';
import { createTestDb } from '../helpers/testDb.js';

const encKey = randomBytes(32);
const TOKEN_A = 'tok-aaaaaaaaaaaaaaaa';
const KEY_B = 'utilities-key-bbbbbbbb';
const authA: UpstreamAuth = { kind: 'bearer', token: TOKEN_A };
const authB: UpstreamAuth = { kind: 'header', header: 'x-utilities-key', value: KEY_B };
const none: UpstreamAuth = { kind: 'none' };

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { logger: createLogger('manager-test', 'debug', dest), lines };
}

interface Env {
  h: DbHandle;
  repo: UpstreamRepository;
  manager: UpstreamManager;
  ctx: CallContext;
  lines: string[];
  lookupCalls: () => number;
}

async function makeEnv(o: { healthIntervalMs?: number; ssrf?: SsrfOptions } = {}): Promise<Env> {
  const h = await createTestDb();
  const repo = new UpstreamRepository(h.db);
  const { logger, lines } = captureLogger();
  const [user] = await h.db
    .insert(schema.users)
    .values({ email: `u-${randomUUID()}@example.com`, name: 'U', role: 'member', passwordHash: 'x' })
    .returning();
  let lookups = 0;
  const ssrf = o.ssrf ?? { allowedInternalHosts: [], allowLoopback: true };
  const counted: SsrfOptions = ssrf.lookup
    ? {
        ...ssrf,
        lookup: (host) => {
          lookups += 1;
          return ssrf.lookup!(host);
        },
      }
    : ssrf;
  const manager = new UpstreamManager({
    repo,
    audit: new AuditWriter(h.db, logger),
    logger,
    encKey,
    ssrf: counted,
    healthIntervalMs: o.healthIntervalMs ?? 100,
    healthTimeoutMs: 500,
    callTimeoutMs: 1000,
  });
  return { h, repo, manager, ctx: { userId: user!.id, apiKeyId: null, source: 'mcp' }, lines, lookupCalls: () => lookups };
}

async function addRow(
  repo: UpstreamRepository,
  r: { slug: string; url: string; auth: UpstreamAuth; name?: string; enabled?: boolean },
): Promise<UpstreamRow> {
  const id = randomUUID();
  const secret = r.auth.kind === 'bearer' ? r.auth.token : r.auth.kind === 'header' ? r.auth.value : null;
  return repo.insert({
    id,
    slug: r.slug,
    name: r.name ?? `Server ${r.slug.toUpperCase()}`,
    url: r.url,
    authType: r.auth.kind,
    authHeaderName: r.auth.kind === 'header' ? r.auth.header : null,
    credentialEnc: secret === null ? null : encryptSecret(secret, encKey, id),
    enabled: r.enabled ?? true,
  });
}

/** Rows for a gateway tool name: (slug, tool) once the server was identified, else the name as requested. */
async function auditRows(env: Env, gatewayName: string) {
  const parsed = parseGatewayToolName(gatewayName);
  const known = parsed ? and(eq(schema.auditLogs.serverSlug, parsed.slug), eq(schema.auditLogs.toolName, parsed.tool)) : undefined;
  const asRequested = and(isNull(schema.auditLogs.serverSlug), eq(schema.auditLogs.toolName, gatewayName));
  return env.h.db.select().from(schema.auditLogs).where(known ? or(known, asRequested) : asRequested);
}

function text(r: CallToolResult): string {
  const first = r.content[0];
  return first?.type === 'text' ? first.text : '';
}

const names = (env: Env) => env.manager.listTools().map((t) => t.name);

describe('UpstreamManager with healthy, slow and dead upstreams', () => {
  let env: Env;
  let fakeA: FakeUpstream;
  let fakeB: FakeUpstream;
  let fakeSlow: FakeUpstream;
  let rowA: UpstreamRow;
  let rowDead: UpstreamRow;

  beforeAll(async () => {
    fakeA = await startFakeUpstream({ name: 'a', tools: ['ping', 'echo'], auth: authA });
    fakeB = await startFakeUpstream({ name: 'b', tools: ['ping'], auth: authB });
    fakeSlow = await startFakeUpstream({ name: 'slow', tools: ['ping'], auth: none, slowMs: 3000 });
    env = await makeEnv();
    rowA = await addRow(env.repo, { slug: 'a', url: fakeA.url, auth: authA });
    await addRow(env.repo, { slug: 'b', url: fakeB.url, auth: authB });
    await addRow(env.repo, { slug: 'slow', url: fakeSlow.url, auth: none });
    rowDead = await addRow(env.repo, { slug: 'dead', url: `http://127.0.0.1:${await closedPort()}/mcp`, auth: none });
    await env.manager.start();
  });

  afterAll(async () => {
    await env.manager.stop();
    await Promise.all([fakeA.stop(), fakeB.stop(), fakeSlow.stop()]);
    await env.h.close();
  });

  it('lists the tools of reachable servers only, sorted, with prefixed descriptions', () => {
    expect(names(env)).toEqual(['a__echo', 'a__ping', 'b__ping', 'slow__ping']);
    const aPing = env.manager.listTools().find((t) => t.name === 'a__ping')!;
    expect(aPing).toMatchObject({ serverId: rowA.id, serverSlug: 'a', upstreamName: 'ping', description: '[Server A] a ping' });
    const dead = env.manager.getState(rowDead.id);
    expect(dead.status).toBe('unreachable');
    expect(dead.lastError).toBe('connection refused');
    expect(dead.tools).toEqual([]);
  });

  it('mirrors health to the database', async () => {
    const a = await env.repo.get(rowA.id);
    expect(a).toMatchObject({ lastStatus: 'connected', toolCount: 2, lastError: null });
    expect(a!.lastCheckedAt).toBeInstanceOf(Date);
    const dead = await env.repo.get(rowDead.id);
    expect(dead).toMatchObject({ lastStatus: 'unreachable', lastError: 'connection refused', toolCount: 0 });
  });

  it('getState is unknown for an id it does not hold', () => {
    expect(env.manager.getState(randomUUID())).toEqual({ status: 'unknown', lastError: null, tools: [], skippedTools: [], checkedAt: null });
  });

  it('listTools stays fast while a slow call is in flight', async () => {
    const inFlight = env.manager.callTool('slow__ping', {}, env.ctx);
    await new Promise((r) => setTimeout(r, 50));
    const t0 = performance.now();
    const listed = names(env);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(listed).toContain('a__ping');
    await inFlight;
  });

  it('routes colliding tool names to their own server', async () => {
    const before = fakeB.calls.length;
    const r = await env.manager.callTool('a__ping', {}, env.ctx);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('a:ping');
    expect(fakeA.calls.map((c) => c.tool)).toContain('ping');
    expect(fakeB.calls.length).toBe(before);
  });

  it('places each credential only where it belongs', async () => {
    await env.manager.callTool('a__echo', {}, env.ctx);
    const r = await env.manager.callTool('b__ping', {}, env.ctx);
    expect(text(r)).toContain('b:ping');
    expect(fakeA.calls.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(fakeA.calls.at(-1)!.headers['x-utilities-key']).toBeUndefined();
    const b = fakeB.calls.at(-1)!;
    expect(b.headers['x-utilities-key']).toBe(KEY_B);
    expect(b.headers.authorization).toBeUndefined();
  });

  it('times out a slow upstream with a clear error and a timeout audit row', async () => {
    const t0 = performance.now();
    const r = await env.manager.callTool('slow__ping', {}, env.ctx);
    const elapsed = performance.now() - t0;
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Upstream 'slow' did not respond within 1000ms");
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2500);
    const rows = await auditRows(env, 'slow__ping');
    const last = rows.at(-1)!;
    expect(last).toMatchObject({ event: 'tool_call', outcome: 'timeout', userId: env.ctx.userId, serverSlug: 'slow', source: 'mcp' });
    expect(last.durationMs).toBeGreaterThanOrEqual(900);
    expect(last.durationMs).toBeLessThan(2500);
    // A timeout is not a connection failure: the server keeps serving.
    expect(env.manager.getState(last.serverId!).status).toBe('connected');
  });

  it('denies an unknown tool with a null serverId', async () => {
    const r = await env.manager.callTool('zzz__ping', {}, env.ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Unknown tool: zzz__ping');
    const [row] = await auditRows(env, 'zzz__ping');
    expect(row).toMatchObject({ outcome: 'denied', serverId: null, serverSlug: null, toolName: 'zzz__ping', userId: env.ctx.userId });
  });

  it('denies an unparseable name and a tool missing from a known server', async () => {
    for (const name of ['noseparator', 'a__nope']) {
      const r = await env.manager.callTool(name, {}, env.ctx);
      expect(text(r)).toBe(`Unknown tool: ${name}`);
      expect((await auditRows(env, name))[0]).toMatchObject({ outcome: 'denied' });
    }
  });

  it('audits a success with timing and logs one line without args or credentials', async () => {
    const before = Date.now();
    await env.manager.callTool('a__echo', { note: 'private-arg-value' }, env.ctx);
    const rows = await auditRows(env, 'a__echo');
    const last = rows.at(-1)!;
    expect(last).toMatchObject({ outcome: 'success', serverId: rowA.id, serverSlug: 'a', toolName: 'echo', apiKeyId: null, errorMessage: null });
    expect(last.startedAt.getTime()).toBeGreaterThanOrEqual(before - 5);
    expect(Number.isInteger(last.durationMs)).toBe(true);
    const logs = env.lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === 'tool call');
    const line = logs.at(-1)!;
    expect(line).toMatchObject({ tool: 'a__echo', server: 'a', outcome: 'success', userId: env.ctx.userId, source: 'mcp' });
    const extra = Object.keys(line).filter((k) => !['level', 'time', 'pid', 'hostname', 'name', 'msg', 'tool', 'server', 'outcome', 'durationMs', 'userId', 'source'].includes(k));
    expect(extra).toEqual([]);
    const all = env.lines.join('\n');
    expect(all).not.toContain('private-arg-value');
    expect(all).not.toContain(TOKEN_A);
    expect(all).not.toContain(KEY_B);
  });
});

describe('UpstreamManager state changes', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function setup(o: { healthIntervalMs?: number; ssrf?: SsrfOptions } = {}): Promise<Env> {
    const env = await makeEnv(o);
    cleanups.push(() => env.h.close());
    cleanups.push(() => env.manager.stop());
    return env;
  }
  async function fake(o: Parameters<typeof startFakeUpstream>[0]): Promise<FakeUpstream> {
    const f = await startFakeUpstream(o);
    cleanups.push(() => f.stop().catch(() => {}));
    return f;
  }

  it('disabling a server removes its tools and denies its calls', async () => {
    const env = await setup();
    const fa = await fake({ name: 'a', tools: ['ping', 'echo'], auth: authA });
    const row = await addRow(env.repo, { slug: 'a', url: fa.url, auth: authA });
    await env.manager.start();
    expect(names(env)).toContain('a__ping');
    const disabled = await env.repo.update(row.id, { enabled: false });
    await env.manager.upsert(disabled!);
    expect(names(env).filter((n) => n.startsWith('a__'))).toEqual([]);
    expect(env.manager.getState(row.id).status).toBe('disabled');
    expect((await env.repo.get(row.id))!.lastStatus).toBe('disabled');
    const r = await env.manager.callTool('a__ping', {}, env.ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Server 'a' is disabled or unreachable");
    expect((await auditRows(env, 'a__ping'))[0]).toMatchObject({ outcome: 'denied', serverId: row.id });
  });

  it('skips only the tool whose prefixed name is invalid (Review Focus 1)', async () => {
    const env = await setup();
    const f = await fake({ name: 'a2', tools: ['ok_tool', 'bad.tool'], auth: none });
    const row = await addRow(env.repo, { slug: 'a2', url: f.url, auth: none });
    await env.manager.start();
    expect(names(env)).toEqual(['a2__ok_tool']);
    const state = env.manager.getState(row.id);
    expect(state.status).toBe('connected');
    expect(state.skippedTools).toEqual(['bad.tool']);
    expect((await env.repo.get(row.id))!.toolCount).toBe(1);
  });

  it('recovers with a fresh client when an upstream restarts on the same port (Review Focus 2)', async () => {
    const env = await setup();
    const fa = await fake({ name: 'a', tools: ['ping', 'echo'], auth: authA });
    const row = await addRow(env.repo, { slug: 'a', url: fa.url, auth: authA });
    await env.manager.start();
    await fa.stop();
    expect((await env.manager.refresh(row.id)).status).toBe('unreachable');
    expect(names(env)).toEqual([]);
    const again = await fake({ name: 'a', tools: ['ping', 'echo'], auth: authA, port: fa.port });
    const state = await env.manager.refresh(row.id);
    expect(state.status).toBe('connected');
    expect(state.lastError).toBeNull();
    const r = await env.manager.callTool('a__ping', {}, env.ctx);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('a:ping');
    expect(again.calls.map((c) => c.tool)).toEqual(['ping']);
  });

  it('never follows a redirect (Review Focus 3)', async () => {
    const env = await setup();
    const redirect = await startRedirectServer('http://169.254.169.254/');
    cleanups.push(() => redirect.stop());
    const row = await addRow(env.repo, { slug: 'redir', url: redirect.url, auth: none });
    await env.manager.start();
    const state = env.manager.getState(row.id);
    expect(state.status).toBe('unreachable');
    expect(state.lastError).toBe('HTTP 302 from upstream (redirects are not followed)');
    expect(redirect.requests).toBeGreaterThan(0);
  });

  it('marks a server unreachable as soon as a call hits a connection failure', async () => {
    // Long interval: the call, not a background tick, must be what notices the dead upstream.
    const env = await setup({ healthIntervalMs: 60_000 });
    const fa = await fake({ name: 'a', tools: ['ping'], auth: authA });
    const fb = await fake({ name: 'b', tools: ['ping'], auth: authB });
    await addRow(env.repo, { slug: 'a', url: fa.url, auth: authA });
    const rowB = await addRow(env.repo, { slug: 'b', url: fb.url, auth: authB });
    await env.manager.start();
    expect(names(env)).toEqual(['a__ping', 'b__ping']);
    await fb.stop();
    const r = await env.manager.callTool('b__ping', {}, env.ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^Upstream 'b' is unreachable: /);
    // Refused on a new socket, or a reset when the pooled keep-alive socket is reused first.
    expect(text(r)).toMatch(/: (connection refused|error: fetch failed \(.*(ECONNRESET|other side closed).*\))$/);
    expect(names(env)).toEqual(['a__ping']);
    expect((await env.repo.get(rowB.id))!.lastStatus).toBe('unreachable');
    expect((await auditRows(env, 'b__ping'))[0]).toMatchObject({ outcome: 'error', serverId: rowB.id });
  });

  it('the health loop notices a stopped upstream within one interval', async () => {
    const env = await setup();
    const fa = await fake({ name: 'a', tools: ['ping'], auth: authA });
    const row = await addRow(env.repo, { slug: 'a', url: fa.url, auth: authA });
    await env.manager.start();
    expect(env.manager.getState(row.id).status).toBe('connected');
    await fa.stop();
    await vi.waitFor(() => expect(env.manager.getState(row.id).status).toBe('unreachable'), { timeout: 2000, interval: 25 });
    expect(names(env)).toEqual([]);
  });

  it('returns an upstream isError result unchanged and audits it as an error', async () => {
    const env = await setup();
    const f = await fake({ name: 'e', tools: ['ping', 'echo'], auth: none, isErrorTool: 'echo' });
    await addRow(env.repo, { slug: 'e', url: f.url, auth: none });
    await env.manager.start();
    const r = await env.manager.callTool('e__echo', {}, env.ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'boom' }]);
    expect((await auditRows(env, 'e__echo'))[0]).toMatchObject({ outcome: 'error', errorMessage: 'boom' });
  });

  it('closes the DNS-rebinding window: a name that re-resolves to loopback at connect time is blocked', async () => {
    let calls = 0;
    const lookup = (): Promise<string[]> => {
      calls += 1;
      return Promise.resolve(calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']);
    };
    const env = await setup({ healthIntervalMs: 60_000, ssrf: { allowedInternalHosts: [], allowLoopback: false, lookup } });
    const f = await fake({ name: 'r', tools: ['ping'], auth: none });
    const row = await addRow(env.repo, { slug: 'rebind', url: `http://rebind.test:${f.port}/mcp`, auth: none });
    await env.manager.start();
    const state = env.manager.getState(row.id);
    expect(state.status).toBe('unreachable');
    expect(state.lastError).toBe('blocked by SSRF guard (loopback)');
    expect(env.lookupCalls()).toBeGreaterThanOrEqual(2);
    expect(f.requests).toBe(0);
  });

  it('never echoes a malformed credential into lastError or logs', async () => {
    const env = await setup({ healthIntervalMs: 60_000 });
    const f = await fake({ name: 'm', tools: ['ping'], auth: none });
    const bad: UpstreamAuth = { kind: 'bearer', token: 'SECRET-PART\r\nX-Injected: 1' };
    const row = await addRow(env.repo, { slug: 'm', url: f.url, auth: bad });
    await env.manager.start();
    const state = env.manager.getState(row.id);
    expect(state.status).toBe('unreachable');
    expect(state.lastError).toBe('error: upstream credential contains characters not allowed in an HTTP header');
    expect(env.lines.join('\n')).not.toContain('SECRET-PART');
    expect(f.requests).toBe(0);
  });

  it('upsert adds a new server and remove drops it', async () => {
    const env = await setup({ healthIntervalMs: 60_000 });
    await env.manager.start();
    const f = await fake({ name: 'n', tools: ['ping'], auth: none });
    const row = await addRow(env.repo, { slug: 'n', url: f.url, auth: none });
    await env.manager.upsert(row);
    expect(names(env)).toEqual(['n__ping']);
    await env.manager.remove(row.id);
    expect(names(env)).toEqual([]);
    expect(env.manager.getState(row.id).status).toBe('unknown');
  });
});
