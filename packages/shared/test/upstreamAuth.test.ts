import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { upstreamAuthMiddleware, type UpstreamAuth } from '../src/upstreamAuth.js';

let server: Server | undefined;

async function start(auth: UpstreamAuth): Promise<string> {
  const app = express();
  app.use(upstreamAuthMiddleware(auth));
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  const s = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  server = s;
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
}

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

const unauthorizedBody = { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null };

describe('upstreamAuthMiddleware bearer', () => {
  const auth: UpstreamAuth = { kind: 'bearer', token: 'right-token-value' };

  it('401 with JSON-RPC body and WWW-Authenticate when header missing', async () => {
    const res = await fetch(await start(auth));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual(unauthorizedBody);
  });
  it('401 on wrong token', async () => {
    const res = await fetch(await start(auth), { headers: { Authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });
  it('200 on right token', async () => {
    const res = await fetch(await start(auth), { headers: { Authorization: 'Bearer right-token-value' } });
    expect(res.status).toBe(200);
  });
  it('accepts lowercase scheme', async () => {
    const res = await fetch(await start(auth), { headers: { Authorization: 'bearer right-token-value' } });
    expect(res.status).toBe(200);
  });
});

describe('upstreamAuthMiddleware header', () => {
  const auth: UpstreamAuth = { kind: 'header', header: 'x-utilities-key', value: 'k-123' };

  it('401 when missing', async () => {
    expect((await fetch(await start(auth))).status).toBe(401);
  });
  it('401 when wrong', async () => {
    expect((await fetch(await start(auth), { headers: { 'X-Utilities-Key': 'nope' } })).status).toBe(401);
  });
  it('200 when right', async () => {
    expect((await fetch(await start(auth), { headers: { 'X-Utilities-Key': 'k-123' } })).status).toBe(200);
  });
});

describe('upstreamAuthMiddleware configuration', () => {
  it.each<[string, UpstreamAuth, RegExp]>([
    ['empty bearer token', { kind: 'bearer', token: '' }, /bearer token is empty/],
    ['blank bearer token', { kind: 'bearer', token: '   ' }, /bearer token is empty/],
    ['empty header name', { kind: 'header', header: '', value: 'k-123' }, /header name is empty/],
    ['empty header value', { kind: 'header', header: 'x-utilities-key', value: '' }, /header value is empty/],
  ])('throws at construction on %s', (_label, auth, message) => {
    expect(() => upstreamAuthMiddleware(auth)).toThrow(message);
  });
});

describe('upstreamAuthMiddleware none', () => {
  it('200 without header', async () => {
    expect((await fetch(await start({ kind: 'none' }))).status).toBe(200);
  });
});
