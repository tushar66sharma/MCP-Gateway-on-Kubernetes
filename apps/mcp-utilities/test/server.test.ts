import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLogger, type RunningMcpHttpServer } from '@urumi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { startUtilitiesServer } from '../src/server.js';

const KEY = 'utilities-key-12345';
const NOW = new Date('2026-10-18T20:00:00Z');
let running: RunningMcpHttpServer | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  await running?.close();
  running = undefined;
});

async function start(extra: Record<string, string> = {}): Promise<RunningMcpHttpServer> {
  running = await startUtilitiesServer({
    config: { ...loadConfig({ UTILITIES_KEY: KEY, ...extra }), PORT: 0 },
    logger: createLogger('test', 'silent'),
    version: '0.0.0-test',
    host: '127.0.0.1',
    now: () => NOW,
  });
  return running;
}

async function connect(extra: Record<string, string> = {}): Promise<Client> {
  const r = await start(extra);
  client = new Client({ name: 'test-client', version: '0.0.1' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${r.port}/mcp`), {
    requestInit: { headers: { 'x-utilities-key': KEY } },
  }));
  return client;
}

describe('mcp-utilities over HTTP', () => {
  it('lists exactly the 4 tools', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['calculate', 'current_time', 'date_range', 'ping']);
    expect(JSON.stringify(tools)).not.toContain('9007199254740991');
  });
  it('date_range in Asia/Kolkata', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'date_range', arguments: { preset: 'today', timezone: 'Asia/Kolkata' } });
    expect(res.structuredContent).toEqual({
      preset: 'today', timezone: 'Asia/Kolkata', after: '2026-10-18T18:30:00.000Z', before: '2026-10-19T18:30:00.000Z',
    });
  });
  it('date_range defaults to DEFAULT_TIMEZONE', async () => {
    const c = await connect({ DEFAULT_TIMEZONE: 'Asia/Kolkata' });
    const res = await c.callTool({ name: 'date_range', arguments: { preset: 'today' } });
    expect(res.structuredContent).toMatchObject({ timezone: 'Asia/Kolkata', after: '2026-10-18T18:30:00.000Z' });
  });
  it('rejects an unknown time zone', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'date_range', arguments: { preset: 'today', timezone: 'Mars/Base' } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('Unknown time zone: Mars/Base');
    const res2 = await c.callTool({ name: 'current_time', arguments: { timezone: 'Mars/Base' } });
    expect(res2.isError).toBe(true);
  });
  it('current_time', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'current_time', arguments: { timezone: 'Asia/Kolkata' } });
    expect(res.structuredContent).toEqual({
      utc: '2026-10-18T20:00:00.000Z', timezone: 'Asia/Kolkata', local: '2026-10-19 01:30:00', offset: '+05:30',
    });
  });
  it('calculate', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'calculate', arguments: { expression: '2+3*4' } });
    expect(res.structuredContent).toEqual({ expression: '2+3*4', result: 14 });
    const bad = await c.callTool({ name: 'calculate', arguments: { expression: '1/0' } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain('Cannot evaluate: division by zero');
  });
  it('pings', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'ping', arguments: {} });
    expect(res.structuredContent).toEqual({ ok: true, server: 'mcp-utilities', time: NOW.toISOString() });
  });
  it('rejects a wrong key (401)', async () => {
    const r = await start();
    client = new Client({ name: 't', version: '0' }, { versionNegotiation: { mode: 'auto' } });
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${r.port}/mcp`), {
      requestInit: { headers: { 'x-utilities-key': 'wrong-key-1234567890' } },
    }))).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${r.port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-utilities-key': 'bad' }, body: '{}',
    });
    expect(res.status).toBe(401);
  });
});

describe('config', () => {
  it('applies defaults, requires the key, validates the zone', () => {
    const c = loadConfig({ UTILITIES_KEY: KEY });
    expect(c).toMatchObject({ PORT: 3003, DEFAULT_TIMEZONE: 'UTC', LOG_LEVEL: 'info' });
    expect(() => loadConfig({})).toThrow(/UTILITIES_KEY/);
    expect(() => loadConfig({ UTILITIES_KEY: KEY, DEFAULT_TIMEZONE: 'Mars/Base' })).toThrow(/DEFAULT_TIMEZONE/);
  });
});
