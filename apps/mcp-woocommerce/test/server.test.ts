import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLogger, startMcpHttpServer, type RunningMcpHttpServer } from '@urumi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { registerWooTools } from '../src/tools/index.js';
import type { QueryValue, WooApi } from '../src/woo/client.js';

const TOKEN = 'integration-token-1234';
const calls: { method: string; path: string; query?: Record<string, QueryValue>; body?: unknown }[] = [];
const fake: WooApi = {
  get: <T>(path: string, query?: Record<string, QueryValue>) => {
    calls.push({ method: 'GET', path, query });
    return Promise.resolve([{
      id: 15, number: '15', status: 'processing', currency: 'INR', total: '10.00',
      date_created_gmt: '2026-10-18T10:00:00', billing: { first_name: 'A', last_name: 'B' }, line_items: [],
    }] as T);
  },
  post: <T>(path: string, body: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve({} as T); },
  put: <T>(path: string, body: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve({} as T); },
};

let running: RunningMcpHttpServer | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  await running?.close();
  running = undefined;
  calls.length = 0;
});

async function connect(): Promise<Client> {
  running = await startMcpHttpServer({
    name: 'mcp-woocommerce', version: '0.0.0-test', port: 0, host: '127.0.0.1',
    auth: { kind: 'bearer', token: TOKEN },
    logger: createLogger('test', 'silent'),
    allowedHosts: ['localhost', '127.0.0.1'],
    registerTools: (s) => registerWooTools(s, { woo: fake, storeTimeZone: 'Asia/Kolkata', now: () => new Date('2026-10-18T20:00:00Z') }),
  });
  client = new Client({ name: 'test-client', version: '0.0.1' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));
  return client;
}

describe('mcp-woocommerce over HTTP', () => {
  it('lists six tools, each with an input schema', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['create_product', 'get_order', 'list_orders', 'list_products', 'ping', 'update_order_status'],
    );
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
    const listOrders = tools.find((t) => t.name === 'list_orders');
    expect(Object.keys(listOrders?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['period', 'after', 'before', 'status', 'page', 'per_page']),
    );
  });

  it('keeps the tool schemas small: no regex pattern, no 2^53-1 bounds, price as string or number', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const json = JSON.stringify(tools);
    expect(json).not.toContain('"pattern"');
    expect(json).not.toContain('9007199254740991');
    const props = (name: string): Record<string, Record<string, unknown>> =>
      (tools.find((t) => t.name === name)?.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    expect(props('list_orders').after).toMatchObject({ type: 'string' });
    expect(String(props('list_orders').after?.description)).toContain('offset');
    expect(props('list_orders').per_page).toMatchObject({ default: 10, maximum: 50 });
    expect(props('list_products').per_page).toMatchObject({ default: 10, maximum: 50 });
    expect(props('create_product').regular_price).toEqual({ type: ['string', 'number'] });
  });

  it('accepts a numeric regular_price over the wire and sends a 2-decimal string', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'create_product', arguments: { name: 'Mug', regular_price: 12.5 } });
    expect(res.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/products', body: { regular_price: '12.50' } });
  });

  it('calls list_orders with period=today and returns structured orders', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'list_orders', arguments: { period: 'today' } });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { orders: { id: number }[]; range: { timeZone: string } };
    expect(sc.orders[0]?.id).toBe(15);
    expect(sc.range.timeZone).toBe('Asia/Kolkata');
    expect(calls[0]?.query).toMatchObject({ after: '2026-10-18T18:30:00', before: '2026-10-19T18:30:00' });
  });

  it('returns a tool-level isError result (ADR-007) for invalid arguments and stays up', async () => {
    const c = await connect();
    const bad = await c.callTool({ name: 'create_product', arguments: { name: 'Mug', regular_price: '12.505' } });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
    const both = await c.callTool({ name: 'list_orders', arguments: { period: 'today', after: '2026-10-01T00:00:00Z' } });
    expect(both.isError).toBe(true);
    const ping = await c.callTool({ name: 'ping', arguments: {} });
    expect(ping.isError).toBeFalsy();
    expect((ping.structuredContent as { ok: boolean }).ok).toBe(true);
  });
});

describe('config', () => {
  const base = {
    WOO_BASE_URL: 'http://wordpress.store.svc.cluster.local',
    WOO_SIGNING_BASE_URL: 'http://store.localhost',
    WOO_CONSUMER_KEY: 'ck_1234567890',
    WOO_CONSUMER_SECRET: 'cs_1234567890',
    MCP_AUTH_TOKEN: 'a-token-of-16-chars',
  };
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ PORT: 3001, STORE_TIMEZONE: 'UTC', WOO_TIMEOUT_MS: 10000, LOG_LEVEL: 'info' });
    expect(c.MCP_ALLOWED_HOSTS).toEqual(['localhost', '127.0.0.1']);
  });
  it('parses allowed hosts, ignoring empty entries', () => {
    expect(loadConfig({ ...base, MCP_ALLOWED_HOSTS: 'a, ,b,' }).MCP_ALLOWED_HOSTS).toEqual(['a', 'b']);
  });
  it('rejects an invalid time zone and a non-http signing URL', () => {
    expect(() => loadConfig({ ...base, STORE_TIMEZONE: 'Mars/Base' })).toThrow(/STORE_TIMEZONE/);
    expect(() => loadConfig({ ...base, WOO_SIGNING_BASE_URL: 'https://store.localhost' })).toThrow(/WOO_SIGNING_BASE_URL/);
  });
  it('oauth1 defaults are unchanged', () => {
    const c = loadConfig(base);
    expect(c.WOO_AUTH_MODE).toBe('oauth1');
    const noSigning: Record<string, string> = { ...base };
    delete noSigning.WOO_SIGNING_BASE_URL;
    expect(() => loadConfig(noSigning)).toThrow(/WOO_SIGNING_BASE_URL/);
    expect(() => loadConfig({ ...base, WOO_BASE_URL: 'https://store.example.com' })).not.toThrow();
  });
  it('basic mode requires an https base URL', () => {
    const noSigning: Record<string, string> = { ...base };
    delete noSigning.WOO_SIGNING_BASE_URL;
    const basic = { ...noSigning, WOO_AUTH_MODE: 'basic' };
    expect(() => loadConfig({ ...basic, WOO_BASE_URL: 'http://store.example.com' })).toThrow(/WOO_BASE_URL/);
    expect(() => loadConfig({ ...basic, WOO_BASE_URL: 'http://wordpress.store.svc.cluster.local' })).toThrow(/WOO_BASE_URL/);
    const ok = loadConfig({ ...basic, WOO_BASE_URL: 'https://store.example.com' });
    expect(ok.WOO_AUTH_MODE).toBe('basic');
    // The signing URL is optional and ignored in basic mode, even if it is not http://.
    expect(() => loadConfig({ ...basic, WOO_BASE_URL: 'https://store.example.com', WOO_SIGNING_BASE_URL: 'https://x.example.com' })).not.toThrow();
    expect(() => loadConfig({ ...base, WOO_AUTH_MODE: 'digest' })).toThrow(/WOO_AUTH_MODE/);
  });
  it('trims the consumer key and secret (a credential file with a newline or a BOM still works)', () => {
    const c = loadConfig({ ...base, WOO_CONSUMER_KEY: '\uFEFFck_1234567890\r\n', WOO_CONSUMER_SECRET: '  cs_1234567890\n' });
    expect(c.WOO_CONSUMER_KEY).toBe('ck_1234567890');
    expect(c.WOO_CONSUMER_SECRET).toBe('cs_1234567890');
    expect(loadConfig(base).WOO_CONSUMER_KEY).toBe('ck_1234567890');
    // The length check applies to the trimmed value.
    expect(() => loadConfig({ ...base, WOO_CONSUMER_KEY: '  ck_123   \n' })).toThrow(/WOO_CONSUMER_KEY/);
  });

  it('credentials in WOO_BASE_URL are rejected', () => {
    for (const mode of ['oauth1', 'basic']) {
      const env = { ...base, WOO_AUTH_MODE: mode, WOO_BASE_URL: 'https://user:hunter2pass@store.example.com' };
      let message = '';
      try { loadConfig(env); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(/WOO_BASE_URL/);
      expect(message).not.toContain('hunter2pass');
      expect(message).not.toContain('user:');
    }
    expect(() => loadConfig({ ...base, WOO_BASE_URL: 'http://ck_abc@wordpress.store.svc.cluster.local' })).toThrow(/WOO_BASE_URL/);
  });
});
