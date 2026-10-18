import { describe, expect, it } from 'vitest';
import { WooClient } from '../src/woo/client.js';
import { WooApiError } from '../src/woo/errors.js';

const consumerKey = 'ck_dummykey00000000000000000000000000000';
const consumerSecret = 'cs_dummysecret0000000000000000000000000000';

interface Recorded { url: URL; init: RequestInit }

function make(handler: (url: URL, init: RequestInit) => Promise<Response>, timeoutMs = 1000) {
  const calls: Recorded[] = [];
  const fetchImpl = ((input: URL | string, init: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const client = new WooClient({
    baseUrl: 'http://wordpress.store.svc.cluster.local', signingBaseUrl: 'http://store.localhost',
    consumerKey, consumerSecret, timeoutMs, fetchImpl,
  });
  return { client, calls };
}

const json = (body: string, status = 200): Promise<Response> =>
  Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }));

async function failure(p: Promise<unknown>): Promise<WooApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(WooApiError);
    return e as WooApiError;
  }
  throw new Error('expected rejection');
}

function expectNoSecrets(e: Error): void {
  for (const s of [consumerKey, consumerSecret, 'oauth_signature']) expect(e.message).not.toContain(s);
  expect(e.message).not.toMatch(/oauth_signature=\S/);
  expect(e.message).not.toMatch(/oauth_consumer_key=\S/);
}

describe('WooClient error redaction', () => {
  it('redacts echoed signed URLs in a redirect page', async () => {
    const html = '<a href="http://wordpress.store.svc.cluster.local/wp-json/wc/v3/products?oauth_consumer_key=ck_dummy&oauth_signature=abc%3D">moved</a>';
    const { client } = make(() => Promise.resolve(new Response(html, { status: 302 })));
    const e = await failure(client.get('/products'));
    expect(e.message).not.toContain('ck_dummy');
    expect(e.message).not.toContain('oauth_signature=abc');
    expect(e.message).toContain('oauth_…=[redacted]');
    expectNoSecrets(e);
  });

  it('redacts the consumer secret and key inside a JSON message', async () => {
    const { client } = make(() =>
      json(JSON.stringify({ code: 'bad', message: `bad ${consumerSecret} and ${consumerKey}` }), 400));
    const e = await failure(client.get('/products'));
    expect(e.message).toBe('bad [redacted] and [redacted]');
    expectNoSecrets(e);
  });

  it('maps a timeout during the body read to timeout', async () => {
    const { client } = make((_url, init) => {
      const res = { ok: true, status: 200, text: () => Promise.reject(init.signal!.reason ?? new DOMException('t', 'TimeoutError')) };
      return Promise.resolve(res as unknown as Response);
    });
    const e = await failure(client.get('/products'));
    expect(e.code).toBe('timeout');
    expectNoSecrets(e);
  });

  it('maps another body read failure to network_error', async () => {
    const { client } = make(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(new TypeError('terminated')) } as unknown as Response));
    const e = await failure(client.get('/products'));
    expect(e.code).toBe('network_error');
    expectNoSecrets(e);
  });
});

describe('WooClient', () => {
  it('signs GET requests and drops undefined query values', async () => {
    const { client, calls } = make(() => json('[]'));
    await expect(client.get('/products', { per_page: 5, search: undefined })).resolves.toEqual([]);
    const { url, init } = calls[0]!;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(url.origin).toBe('http://wordpress.store.svc.cluster.local');
    expect(url.pathname).toBe('/wp-json/wc/v3/products');
    expect(url.searchParams.get('per_page')).toBe('5');
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.has('oauth_signature')).toBe(true);
    expect(url.toString()).not.toContain(consumerSecret);
  });

  it('posts a JSON body', async () => {
    const { client, calls } = make(() => json('{"id":1}'));
    await expect(client.post('/products', { name: 'Mug' })).resolves.toEqual({ id: 1 });
    const { init } = calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Mug"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('puts with PUT', async () => {
    const { client, calls } = make(() => json('{}'));
    await client.put('/products/1', { price: '1' });
    expect(calls[0]!.init.method).toBe('PUT');
  });

  it('maps a WooCommerce error body', async () => {
    const { client } = make(() =>
      json('{"code":"woocommerce_rest_shop_order_invalid_id","message":"Invalid ID.","data":{"status":404}}', 404));
    const e = await failure(client.get('/orders/9'));
    expect([e.status, e.code, e.message]).toEqual([404, 'woocommerce_rest_shop_order_invalid_id', 'Invalid ID.']);
    expectNoSecrets(e);
  });

  it('maps an HTML 500 to http_500 with a bounded message', async () => {
    const { client } = make(() => Promise.resolve(new Response(`<html>${'x'.repeat(5000)}</html>`, { status: 500 })));
    const e = await failure(client.get('/products'));
    expect(e.status).toBe(500);
    expect(e.code).toBe('http_500');
    expect(e.message.length).toBeLessThanOrEqual(200);
    expectNoSecrets(e);
  });

  it('does not follow redirects', async () => {
    const { client } = make(() => Promise.resolve(new Response('', { status: 301, headers: { location: 'http://elsewhere/' } })));
    const e = await failure(client.get('/products'));
    expect(e.status).toBe(301);
    expectNoSecrets(e);
  });

  it('times out', async () => {
    const { client } = make(
      (_url, init) => new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      }),
      50,
    );
    const e = await failure(client.get('/products'));
    expect(e.code).toBe('timeout');
    expectNoSecrets(e);
  });

  it('maps fetch failures to network_error', async () => {
    const { client } = make(() => Promise.reject(new TypeError('fetch failed')));
    const e = await failure(client.get('/products'));
    expect(e.code).toBe('network_error');
    expectNoSecrets(e);
  });

  it('maps a non-JSON 200 to bad_response', async () => {
    const { client } = make(() => Promise.resolve(new Response('<html>hi</html>', { status: 200 })));
    const e = await failure(client.get('/products'));
    expect(e.code).toBe('bad_response');
    expectNoSecrets(e);
  });
});
