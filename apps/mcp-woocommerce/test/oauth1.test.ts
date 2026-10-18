import { describe, expect, it } from 'vitest';
import { buildOAuth1BaseString, OAuth1Error, signOAuth1 } from '../src/woo/oauth1.js';

// Known-answer vector produced by an independent PHP implementation (see scripts/dev/woo-oauth-check.test.mjs).
const consumerKey = 'ck_dummykey00000000000000000000000000000';
const consumerSecret = 'cs_dummysecret0000000000000000000000000000';
const nonce = 'abcdef0123456789abcdef0123456789';
const timestamp = 1760000000;
const signingBaseUrl = 'http://store.localhost';
const EXPECTED_BASE_STRING =
  'GET&http%3A%2F%2Fstore.localhost%2Fwp-json%2Fwc%2Fv3%2Fproducts&' +
  'a0%3D1%26a%253Ab%3D2%26name%3Dcaf%25C3%25A9%26' +
  'oauth_consumer_key%3Dck_dummykey00000000000000000000000000000%26' +
  'oauth_nonce%3Dabcdef0123456789abcdef0123456789%26oauth_signature_method%3DHMAC-SHA256%26' +
  'oauth_timestamp%3D1760000000%26orderby%3Ddate%26per_page%3D5%26search%3Dmug%2520%2526%2520cup';
const EXPECTED_SIGNATURE = 'lGODYY6tV/Ik3bMkgqOu1GcejVuxp2ku6Y/CJXxpaxk=';
const requestUrl =
  'http://127.0.0.1:18088/wp-json/wc/v3/products?per_page=5&search=mug%20%26%20cup&a0=1&a%3Ab=2&orderby=date&name=caf%C3%A9';

const base = { method: 'GET', signingBaseUrl, consumerKey, consumerSecret, nonce, timestamp };

describe('oauth1', () => {
  it('matches the PHP known-answer base string', () => {
    const params = new Map([
      ['per_page', '5'], ['search', 'mug & cup'], ['a0', '1'], ['a:b', '2'], ['orderby', 'date'], ['name', 'café'],
      ['oauth_consumer_key', consumerKey], ['oauth_nonce', nonce],
      ['oauth_signature_method', 'HMAC-SHA256'], ['oauth_timestamp', String(timestamp)],
    ]);
    expect(buildOAuth1BaseString('GET', 'http://store.localhost/wp-json/wc/v3/products', params)).toBe(EXPECTED_BASE_STRING);
  });

  it('matches the PHP known-answer signature and keeps the request host', () => {
    const url = signOAuth1({ ...base, url: requestUrl });
    expect(url.searchParams.get('oauth_signature')).toBe(EXPECTED_SIGNATURE);
    expect(url.origin).toBe('http://127.0.0.1:18088');
    expect(url.searchParams.get('search')).toBe('mug & cup');
    expect(url.searchParams.get('name')).toBe('café');
  });

  it('signs the public URL, not the internal host', () => {
    const internal = signOAuth1({ ...base, url: 'http://wordpress.store.svc.cluster.local/wp-json/wc/v3/products?per_page=5' });
    const pub = signOAuth1({ ...base, url: 'http://store.localhost/wp-json/wc/v3/products?per_page=5' });
    expect(internal.host).toBe('wordpress.store.svc.cluster.local');
    expect(internal.searchParams.get('oauth_signature')).toBe(pub.searchParams.get('oauth_signature'));
  });

  it('rejects duplicate keys', () => {
    expect(() => signOAuth1({ ...base, url: 'http://x/wp-json/wc/v3/products?id=1&id=2' })).toThrow(OAuth1Error);
  });

  it.each(['include[]=1', 'include%5B0%5D=1', 'a.b=1', 'a%20b=1', 'a]=1'])('rejects unsupported key %s', (q) => {
    expect(() => signOAuth1({ ...base, url: `http://x/wp-json/wc/v3/products?${q}` })).toThrow(OAuth1Error);
  });

  it('rejects a caller-supplied oauth_nonce', () => {
    expect(() => signOAuth1({ ...base, url: 'http://x/wp-json/wc/v3/products?oauth_nonce=abc' })).toThrow(OAuth1Error);
  });

  it('signs a __proto__ key like any other key', () => {
    const url = signOAuth1({ ...base, url: 'http://x/wp-json/wc/v3/products?__proto__=1&per_page=5' });
    expect(url.searchParams.get('__proto__')).toBe('1');
    expect(url.searchParams.get('per_page')).toBe('5');
    const params = new Map([['__proto__', '1'], ['per_page', '5']]);
    expect(params.get('__proto__')).toBe('1');
    expect(Object.getPrototypeOf(params)).toBe(Map.prototype);
    expect(buildOAuth1BaseString('GET', 'http://x/p', params)).toContain('__proto__%3D1');
  });

  it('never puts the consumer secret in the URL', () => {
    expect(signOAuth1({ ...base, url: requestUrl }).toString()).not.toContain(consumerSecret);
  });
});
