import { request } from 'node:http';
import { Writable } from 'node:stream';
import net from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';
import { mcpRequestLocals, startMcpHttpServer, type McpHttpServerOptions, type RunningMcpHttpServer } from '../src/mcpHttpServer.js';
import { ok } from '../src/tools.js';

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

  it('custom auth function: res.locals reach the tool handler', async () => {
    const { port } = await start({
      auth: (_req, res, next) => {
        res.locals.user = 'u1';
        next();
      },
      registerTools: undefined,
      buildServer: () => {
        const s = new McpServer({ name: 'g', version: '1' });
        s.registerTool('who', { description: 'who' }, async () => ok('who', { user: mcpRequestLocals.getStore()?.user }) as CallToolResult);
        return s;
      },
    });
    const client = new Client({ name: 'c', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)), { timeout: 5000 });
    const r = await client.callTool({ name: 'who', arguments: {} });
    expect(r.structuredContent).toEqual({ user: 'u1' });
    await client.close();
  });

  it('custom auth function can reject', async () => {
    let calls = 0;
    const { port } = await start({
      auth: (_req, res) => {
        res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
      },
      registerTools: undefined,
      buildServer: () => {
        const s = new McpServer({ name: 'g', version: '1' });
        s.registerTool('who', { description: 'who' }, async () => {
          calls++;
          return ok('who', {}) as CallToolResult;
        });
        return s;
      },
    });
    const client = new Client({ name: 'c', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    await expect(
      client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)), { timeout: 5000 }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('extraRoutes are served and not host-checked', async () => {
    const { port } = await start({ extraRoutes: (app) => app.get('/api/hello', (_q, r) => r.json({ hi: true })) });
    const res = await rawRequest(port, { method: 'GET', path: '/api/hello', host: 'evil.example' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ hi: true });
  });

  it('malformed JSON on /mcp -> 400 -32700', async () => {
    const { port } = await start();
    const res = await rawRequest(port, { method: 'POST', path: '/mcp', headers: postHeaders, body: '{"jsonrpc":' });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32700);
    expect(body.error.message).toBe('Invalid request body');
  });

  it('body over 1mb -> 413 -32700', async () => {
    const { port } = await start();
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'a'.repeat(1_100_000) } });
    const res = await rawRequest(port, { method: 'POST', path: '/mcp', headers: postHeaders, body: big });
    expect(res.status).toBe(413);
    expect((JSON.parse(res.body) as { error: { code: number } }).error.code).toBe(-32700);
  });

  it('X-Request-Id echoed when valid, replaced when not', async () => {
    const { port } = await start();
    const a = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { 'X-Request-Id': 'abcd-1234-efgh' } });
    expect(a.headers.get('x-request-id')).toBe('abcd-1234-efgh');
    const b = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { 'X-Request-Id': '<script>' } });
    expect(b.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('logPath sanitises the logged path and the log line carries requestId', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const { port } = await start({
      logger: createLogger('test', 'info', stream),
      logPath: (p) => p.replace(/^\/api\/invites\/[^/]+/, '/api/invites/:token'),
      extraRoutes: (app) => app.get('/api/invites/:token', (_q, r) => r.json({ ok: true })),
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/invites/SECRET123`, { headers: { 'X-Request-Id': 'req-abcdefgh' } });
    await res.text();
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.join('')).not.toContain('SECRET123');
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((o) => o.msg === 'request');
    expect(line).toMatchObject({ path: '/api/invites/:token', requestId: 'req-abcdefgh' });
  });

  it('logPath sees the full path for routes mounted under a prefix, without the query', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const { port } = await start({
      logger: createLogger('test', 'info', stream),
      logPath: (p) => p.replace(/^\/api\/invites\/[^/]+/, '/api/invites/:token'),
      extraRoutes: (app) => {
        const router = express.Router();
        router.get('/invites/:t', (_q, r) => r.json({ ok: true }));
        app.use('/api', router);
      },
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/invites/SECRET123?x=1`);
    await res.text();
    await new Promise((r) => setTimeout(r, 50));
    const all = lines.join('');
    expect(all).not.toContain('SECRET123');
    expect(all).not.toContain('x=1');
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((o) => o.msg === 'request');
    expect(line).toMatchObject({ path: '/api/invites/:token' });
  });

  it('exactly one of registerTools / buildServer', async () => {
    const msg = 'exactly one of registerTools or buildServer is required';
    await expect(start({ buildServer: () => new McpServer({ name: 'g', version: '1' }) })).rejects.toThrow(msg);
    await expect(start({ registerTools: undefined })).rejects.toThrow(msg);
  });
});
