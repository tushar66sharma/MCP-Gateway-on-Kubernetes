import { desc } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { auditLogs } from '../../src/db/schema.js';
import { csrf, startHarness, type Harness } from '../helpers/harness.js';

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const TOO_MANY = { jsonrpc: '2.0', error: { code: -32029, message: 'Too many failed authentication attempts' }, id: null };

describe('/mcp authentication failure limit', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  const rawMcp = (bearer: string, headers: Record<string, string> = {}) => {
    const t = request(h.baseUrl).post('/mcp').set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json').set('Authorization', `Bearer ${bearer}`);
    for (const [k, v] of Object.entries(headers)) t.set(k, v);
    return t.send(LIST);
  };
  const auditRows = () => h.deps.db.db.select().from(auditLogs).orderBy(desc(auditLogs.id));

  /** A member's API key; revoke it to get a recognised-but-rejected credential. */
  async function makeKey(): Promise<{ id: string; plaintext: string; revoke(): Promise<void> }> {
    await h.createUser({ email: 'member@example.com', role: 'member', password: 'member-password-1' });
    const cookie = await h.loginAs('member@example.com', 'member-password-1');
    const created = await csrf(request(h.baseUrl).post('/api/keys'), cookie).send({ name: 'limit' });
    const body = created.body as { key: { id: string }; plaintext: string };
    return { id: body.key.id, plaintext: body.plaintext, revoke: async () => void (await csrf(request(h.baseUrl).delete(`/api/keys/${body.key.id}`), cookie)) };
  }

  it('recognised failures over the limit answer 429 with Retry-After and write no audit row', async () => {
    h = await startHarness({ env: { MCP_AUTH_FAILURE_LIMIT_PER_MIN: '2' } });
    const key = await makeKey();
    await key.revoke();
    const before = (await auditRows()).length;
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 3; i++) {
      last = await rawMcp(key.plaintext);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 429]);
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);
    expect(last?.body).toEqual(TOO_MANY);
    expect((await auditRows()).length).toBe(before + 2);
    // Another request in the window is still limited, and the warn line is written once, without the key.
    expect((await rawMcp(key.plaintext)).status).toBe(429);
    const warns = h.logs.filter((l) => l.includes('mcp auth failures limited'));
    expect(warns.length).toBe(1);
    expect(h.logs.some((l) => l.includes(key.plaintext))).toBe(false);
  });

  it('a valid key passes while its IP is over the failure limit', async () => {
    h = await startHarness({ env: { MCP_AUTH_FAILURE_LIMIT_PER_MIN: '2' } });
    const good = await makeKey();
    const other = await csrf(request(h.baseUrl).post('/api/keys'), await h.loginAs('member@example.com', 'member-password-1')).send({ name: 'dead' });
    const dead = (other.body as { key: { id: string }; plaintext: string });
    await csrf(request(h.baseUrl).delete(`/api/keys/${dead.key.id}`), await h.loginAs('member@example.com', 'member-password-1'));
    for (let i = 0; i < 3; i++) await rawMcp(dead.plaintext);
    expect((await rawMcp(dead.plaintext)).status).toBe(429);
    expect((await rawMcp(good.plaintext)).status).toBe(200);
    expect((await rawMcp(good.plaintext)).status).toBe(200);
  });

  it('unrecognised credentials are not counted', async () => {
    h = await startHarness({ env: { MCP_AUTH_FAILURE_LIMIT_PER_MIN: '2' } });
    const key = await makeKey();
    await key.revoke();
    for (let i = 0; i < 50; i++) expect((await rawMcp('garbage')).status).toBe(401);
    expect((await rawMcp(key.plaintext)).status).toBe(401);
  });

  it('the limit window resets', async () => {
    h = await startHarness({ env: { MCP_AUTH_FAILURE_LIMIT_PER_MIN: '2' } });
    const key = await makeKey();
    await key.revoke();
    for (let i = 0; i < 2; i++) await rawMcp(key.plaintext);
    expect((await rawMcp(key.plaintext)).status).toBe(429);
    h.advanceTime(60_000);
    expect((await rawMcp(key.plaintext)).status).toBe(401);
  });

  it('limits per client IP from X-Forwarded-For with TRUST_PROXY=1', async () => {
    h = await startHarness({ env: { MCP_AUTH_FAILURE_LIMIT_PER_MIN: '1', TRUST_PROXY: '1' } });
    const key = await makeKey();
    await key.revoke();
    const from = (ip: string) => rawMcp(key.plaintext, { 'X-Forwarded-For': ip }).then((r) => r.status);
    expect(await from('203.0.113.10')).toBe(401);
    expect(await from('203.0.113.10')).toBe(429);
    expect(await from('203.0.113.20')).toBe(401);
  });
});
