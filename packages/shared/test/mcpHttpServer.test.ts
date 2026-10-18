import { request } from 'node:http';
import net from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';
import { startMcpHttpServer, type McpHttpServerOptions, type RunningMcpHttpServer } from '../src/mcpHttpServer.js';

const TOKEN = 'test-bearer-token';
const logger = createLogger('test', 'silent');
let running: RunningMcpHttpServer | undefined;

async function start(extra: Partial<McpHttpServerOptions> = {}): Promise<RunningMcpHttpServer> {
  running = await startMcpHttpServer({
    name: 'test-server',
    version: '0.0.1',
    port: 0,
    host: '127.0.0.1',
    auth: { kind: 'bearer', token: TOKEN },
    logger,
    allowedHosts: ['localhost', '127.0.0.1'],
    registerTools: (server) => {
      server.registerTool('ping', { description: 'Replies pong.' }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }));
    },
    ...extra,
  });
  return running;
}

afterEach(async () => {
  const r = running;
  running = undefined;
  if (r) await r.close();
});

// fetch cannot override the Host header, so Host tests use node:http.
function rawRequest(
  port: number,
  opts: { method: string; path: string; host?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: { ...(opts.host ? { Host: opts.host } : {}), ...opts.headers },
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
});
const postHeaders = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${TOKEN}`,
};

describe('startMcpHttpServer', () => {
  it('serves /healthz and /readyz', async () => {
    const { port } = await start();
    const h = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ status: 'ok' });
    const r = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'ready' });
  });

  it('/readyz is 503 when readinessCheck is false', async () => {
    const { port } = await start({ readinessCheck: async () => false });
    const r = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ status: 'not ready' });
  });

  it('GET and DELETE /mcp return 405', async () => {
    const { port } = await start();
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(405);
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      });
    }
  });

  it('POST /mcp without auth is 401', async () => {
    const { port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: initBody,
    });
    expect(res.status).toBe(401);
  });

  it('Host check applies to /mcp only', async () => {
    const { port } = await start({
      allowedHosts: ['mcp-woocommerce.mcp.svc.cluster.local:3001', '127.0.0.1:0', '127.0.0.1', ''],
    });
    const evil = await rawRequest(port, { method: 'POST', path: '/mcp', host: 'evil.example', headers: postHeaders, body: initBody });
    expect(evil.status).toBe(403);
    const good = await rawRequest(port, {
      method: 'POST',
      path: '/mcp',
      host: 'mcp-woocommerce.mcp.svc.cluster.local:3001',
      headers: postHeaders,
      body: initBody,
    });
    expect(good.status).toBe(200);
    const health = await rawRequest(port, { method: 'GET', path: '/healthz', host: '10.42.0.15:3001' });
    expect(health.status).toBe(200);
    const ready = await rawRequest(port, { method: 'GET', path: '/readyz', host: '10.42.0.15:3001' });
    expect(ready.status).toBe(200);
  });

  it('ignores empty allowedHosts entries', async () => {
    const { port } = await start({ allowedHosts: ['127.0.0.1', ''] });
    const res = await rawRequest(port, { method: 'POST', path: '/mcp', host: 'other.example', headers: postHeaders, body: initBody });
    expect(res.status).toBe(403);
  });

  it('lowercases allowedHosts entries (the SDK compares the lowercase URL hostname)', async () => {
    const { port } = await start({ allowedHosts: ['MCP-WooCommerce.MCP.svc:3001'] });
    const res = await rawRequest(port, { method: 'POST', path: '/mcp', host: 'mcp-woocommerce.mcp.svc:3001', headers: postHeaders, body: initBody });
    expect(res.status).toBe(200);
    const upper = await rawRequest(port, { method: 'POST', path: '/mcp', host: 'MCP-WOOCOMMERCE.mcp.svc', headers: postHeaders, body: initBody });
    expect(upper.status).toBe(200);
  });

  it('refuses to start when allowedHosts is empty after filtering', async () => {
    await expect(start({ allowedHosts: ['', '  '] })).rejects.toThrow(/allowedHosts is empty/);
    await expect(start({ allowedHosts: [] })).rejects.toThrow(/allowedHosts is empty/);
  });

  it('refuses to start with an empty configured auth secret', async () => {
    await expect(start({ auth: { kind: 'bearer', token: '' } })).rejects.toThrow(/bearer token is empty/);
  });

  it('works with the SDK client: listTools and callTool', async () => {
    const { port } = await start();
    const client = new Client({ name: 'test-client', version: '0.0.1' }, { versionNegotiation: { mode: 'auto' } });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    await client.connect(transport, { timeout: 5000 });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('ping');
    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
    await client.close();
  });

  it('close() resolves and frees the port', async () => {
    const srv = await start();
    const { port } = srv;
    await srv.close();
    running = undefined;
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => s.close(() => resolve()));
    });
  });
});
