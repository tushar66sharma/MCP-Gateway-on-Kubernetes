import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { startNotesServer } from '../src/server.js';

const TOKEN = 'notes-token-1234567';
let running: RunningMcpHttpServer | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  await running?.close();
  running = undefined;
});

async function start(): Promise<RunningMcpHttpServer> {
  running = await startNotesServer({
    config: { ...loadConfig({ MCP_AUTH_TOKEN: TOKEN }), PORT: 0 },
    logger: createLogger('test', 'silent'),
    version: '0.0.0-test',
    host: '127.0.0.1',
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return running;
}

async function connect(): Promise<Client> {
  const r = await start();
  client = new Client({ name: 'test-client', version: '0.0.1' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${r.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));
  return client;
}

describe('mcp-notes over HTTP', () => {
  it('lists exactly the 5 tools and keeps schemas bounded', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_note', 'delete_note', 'list_notes', 'ping', 'search_notes']);
    expect(JSON.stringify(tools)).not.toContain('9007199254740991');
  });
  it('creates a note and lists, searches and deletes it', async () => {
    const c = await connect();
    const created = await c.callTool({ name: 'create_note', arguments: { title: 'Hi', content: 'Body' } });
    expect(created.isError).toBeFalsy();
    const list = await c.callTool({ name: 'list_notes', arguments: {} });
    const sc = list.structuredContent as { notes: { id: number; title: string }[]; count: number };
    expect(sc.count).toBe(1);
    expect(sc.notes[0]).toMatchObject({ id: 1, title: 'Hi' });
    const found = await c.callTool({ name: 'search_notes', arguments: { query: 'BODY' } });
    expect((found.structuredContent as { count: number }).count).toBe(1);
    const del = await c.callTool({ name: 'delete_note', arguments: { id: 1 } });
    expect(del.structuredContent).toEqual({ deleted: true, id: 1 });
  });
  it('reports a missing note as a tool error', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'delete_note', arguments: { id: 99 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Note 99 not found.');
  });
  it('pings', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'ping', arguments: {} });
    expect(res.structuredContent).toEqual({ ok: true, server: 'mcp-notes', time: '2026-10-19T10:00:00.000Z' });
  });
  it('rejects a missing or wrong token (401)', async () => {
    const r = await start();
    const res = await fetch(`http://127.0.0.1:${r.port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    client = new Client({ name: 't', version: '0' }, { versionNegotiation: { mode: 'auto' } });
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${r.port}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer wrong-token-1234567' } },
    }))).rejects.toThrow();
  });
});

describe('config', () => {
  it('applies defaults and requires the token', () => {
    const c = loadConfig({ MCP_AUTH_TOKEN: TOKEN });
    expect(c).toMatchObject({ PORT: 3002, LOG_LEVEL: 'info' });
    expect(c.MCP_ALLOWED_HOSTS).toEqual(['localhost', '127.0.0.1']);
    expect(() => loadConfig({})).toThrow(/MCP_AUTH_TOKEN/);
  });
});
