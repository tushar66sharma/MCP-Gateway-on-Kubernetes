import { randomUUID } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { UpstreamAuth } from '@urumi/shared';
import { desc } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintInternalToken } from '../../src/auth/internalToken.js';
import type { AuthUser } from '../../src/auth/users.js';
import { auditLogs } from '../../src/db/schema.js';
import type { UpstreamRecord } from '../../src/upstreams/connection.js';
import { startFakeUpstream, type FakeUpstream } from '../helpers/fakeUpstream.js';
import { csrf, INTERNAL_SECRET, startHarness, type Harness } from '../helpers/harness.js';

const WOO_AUTH: UpstreamAuth = { kind: 'bearer', token: 'woo-upstream-token-1234' };
const NOTES_AUTH: UpstreamAuth = { kind: 'bearer', token: 'notes-upstream-token-5678' };
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

async function connect(baseUrl: string, bearer: string): Promise<Client> {
  const client = new Client({ name: 'endpoint-test', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  return client;
}

async function upstreamTools(fake: FakeUpstream, token: string) {
  const client = await connect(fake.url.replace(/\/mcp$/, ''), token);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

describe('aggregated /mcp endpoint', () => {
  let woo: FakeUpstream;
  let notes: FakeUpstream;
  let h: Harness;
  let member: AuthUser;
  let memberCookie: string;
  let key: { id: string; plaintext: string };
  let client: Client;

  const auditRows = () => h.deps.db.db.select().from(auditLogs).orderBy(desc(auditLogs.id));
  const rawMcp = (headers: Record<string, string>) => {
    const t = request(h.baseUrl).post('/mcp').set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) t.set(k, v);
    return t.send(LIST);
  };

  beforeAll(async () => {
    woo = await startFakeUpstream({ name: 'woo', tools: ['list_orders', 'ping'], auth: WOO_AUTH });
    notes = await startFakeUpstream({ name: 'notes', tools: ['create_note', 'ping'], auth: NOTES_AUTH, isErrorTool: 'create_note' });
    const upstreams: UpstreamRecord[] = [
      { id: randomUUID(), slug: 'woo', name: 'WooCommerce', url: woo.url, enabled: true, auth: WOO_AUTH },
      { id: randomUUID(), slug: 'notes', name: 'Notes', url: notes.url, enabled: true, auth: NOTES_AUTH },
    ];
    h = await startHarness({ upstreams });
    member = await h.createUser({ email: 'member@example.com', role: 'member', password: 'member-password-1' });
    memberCookie = await h.loginAs('member@example.com', 'member-password-1');
    const created = await csrf(request(h.baseUrl).post('/api/keys'), memberCookie).send({ name: 'endpoint' });
    expect(created.status).toBe(201);
    const body = created.body as { key: { id: string }; plaintext: string };
    key = { id: body.key.id, plaintext: body.plaintext };
    client = await connect(h.baseUrl, key.plaintext);
  });

  afterAll(async () => {
    await client?.close();
    await h?.close();
    await Promise.all([woo?.stop(), notes?.stop()]);
  });

  it('lists every connected tool, prefixed, with the upstream input schema unchanged', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['notes__create_note', 'notes__ping', 'woo__list_orders', 'woo__ping']);
    for (const t of tools) {
      expect(t.description).toMatch(t.name.startsWith('woo__') ? /^\[WooCommerce\] / : /^\[Notes\] /);
    }
    const direct = await upstreamTools(woo, WOO_AUTH.kind === 'bearer' ? WOO_AUTH.token : '');
    const listOrders = direct.find((t) => t.name === 'list_orders');
    expect(tools.find((t) => t.name === 'woo__list_orders')?.inputSchema).toEqual(listOrders?.inputSchema);
  });

  it('calls a tool, returns structuredContent unchanged and audits the call', async () => {
    const before = (await auditRows()).length;
    const result = await client.callTool({ name: 'woo__list_orders', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ server: 'woo', tool: 'list_orders' });
    const rows = await auditRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({
      event: 'tool_call',
      source: 'mcp',
      userId: member.id,
      apiKeyId: key.id,
      serverSlug: 'woo',
      toolName: 'list_orders',
      outcome: 'success',
    });
  });

  it("passes an upstream isError result through and audits it as 'error'", async () => {
    const result = await client.callTool({ name: 'notes__create_note', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'boom' }]);
    expect((await auditRows())[0]).toMatchObject({ event: 'tool_call', serverSlug: 'notes', toolName: 'create_note', outcome: 'error', errorMessage: 'boom' });
  });

  it('denies an unknown tool and audits the requested name, capped at 200 characters', async () => {
    const unknown = await client.callTool({ name: 'zzz__ping', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toEqual([{ type: 'text', text: 'Unknown tool: zzz__ping' }]);
    expect((await auditRows())[0]).toMatchObject({ event: 'tool_call', outcome: 'denied', userId: member.id, serverSlug: null, toolName: 'zzz__ping' });
    const long = await client.callTool({ name: 'x'.repeat(300), arguments: {} });
    expect(long.content).toEqual([{ type: 'text', text: `Unknown tool: ${'x'.repeat(200)}…` }]);
    expect((await auditRows())[0]?.toolName).toBe('x'.repeat(200));
  });

  it("never forwards the client's gateway key upstream", async () => {
    await client.callTool({ name: 'woo__ping', arguments: {} });
    await client.callTool({ name: 'notes__ping', arguments: {} });
    const recorded = [...woo.calls, ...notes.calls];
    expect(recorded.length).toBeGreaterThan(0);
    for (const call of recorded) {
      const values = Object.values(call.headers).filter((v): v is string => typeof v === 'string');
      expect(values.join('\n')).not.toContain(key.plaintext);
      for (const v of values) {
        expect(v.startsWith('ugw_')).toBe(false);
        expect(v).not.toMatch(/\bugw_/);
      }
    }
    expect(woo.calls.at(-1)?.headers.authorization).toBe(`Bearer ${WOO_AUTH.kind === 'bearer' ? WOO_AUTH.token : ''}`);
  });

  it('accepts an internal chat token and audits its calls with source chat', async () => {
    const token = await mintInternalToken(member.id, INTERNAL_SECRET);
    const chat = await connect(h.baseUrl, token);
    try {
      expect((await chat.listTools()).tools.length).toBe(4);
      await chat.callTool({ name: 'woo__ping', arguments: {} });
    } finally {
      await chat.close();
    }
    expect((await auditRows())[0]).toMatchObject({ event: 'tool_call', source: 'chat', userId: member.id, apiKeyId: null, serverSlug: 'woo', toolName: 'ping', outcome: 'success' });
  });

  it('rejects an unknown ugw_ key with 401 and audits it without a user', async () => {
    const before = (await auditRows()).length;
    const res = await rawMcp({ Authorization: `Bearer ugw_${'A'.repeat(43)}` });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.body).toEqual({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    const rows = await auditRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ event: 'auth_rejected', outcome: 'unauthorized', source: 'mcp', userId: null, apiKeyId: null, toolName: null, serverId: null, serverSlug: null, durationMs: 0 });
  });

  it('rejects an unrecognisable credential with 401 and writes no audit row', async () => {
    const otherSecret = await mintInternalToken(member.id, 'o'.repeat(32));
    for (const value of ['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer x', 'Bearer not-a-gateway-token', 'Bearer ugw_short', `Bearer ugw_${'A'.repeat(44)}`, `Bearer ${otherSecret}`]) {
      const before = (await auditRows()).length;
      const res = await rawMcp({ Authorization: value });
      expect(res.status, value.slice(0, 20)).toBe(401);
      expect((res.body as { error: { code: number } }).error.code).toBe(-32001);
      expect((await auditRows()).length, value.slice(0, 20)).toBe(before);
    }
  });

  it('audits an expired but validly signed internal token to its user with source chat', async () => {
    const expired = await mintInternalToken(member.id, INTERNAL_SECRET, 300, new Date(Date.now() - 400_000));
    const before = (await auditRows()).length;
    const res = await rawMcp({ Authorization: `Bearer ${expired}` });
    expect(res.status).toBe(401);
    const rows = await auditRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ event: 'auth_rejected', outcome: 'unauthorized', source: 'chat', userId: member.id, apiKeyId: null, errorMessage: 'internal token expired' });
  });

  it('rejects a missing Authorization header with 401 and writes no audit row', async () => {
    const before = (await auditRows()).length;
    const res = await rawMcp({});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect((res.body as { error: { code: number } }).error.code).toBe(-32001);
    expect((await auditRows()).length).toBe(before);
  });

  it('rejects a foreign Host header with 403', async () => {
    const res = await rawMcp({ Authorization: `Bearer ${key.plaintext}`, Host: 'evil.example' });
    expect(res.status).toBe(403);
  });

  it('answers GET /mcp with 405 JSON and Allow: POST', async () => {
    const res = await request(h.baseUrl).get('/mcp');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('never logs the key, the upstream credentials or tool results', () => {
    const logs = h.logs.join('');
    expect(logs).not.toContain(key.plaintext);
    expect(logs).not.toContain('woo-upstream-token-1234');
    expect(logs).not.toContain('notes-upstream-token-5678');
    expect(logs).not.toContain('woo:list_orders');
  });

  // Last: revokes the shared key.
  it('rejects the very next request after the key is revoked, audited to its owner', async () => {
    const del = await csrf(request(h.baseUrl).delete(`/api/keys/${key.id}`), memberCookie);
    expect(del.status).toBe(204);
    const res = await rawMcp({ Authorization: `Bearer ${key.plaintext}` });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    expect((await auditRows())[0]).toMatchObject({ event: 'auth_rejected', outcome: 'unauthorized', source: 'mcp', userId: member.id, apiKeyId: key.id });
    await expect(client.listTools()).rejects.toThrow();
  });
});
