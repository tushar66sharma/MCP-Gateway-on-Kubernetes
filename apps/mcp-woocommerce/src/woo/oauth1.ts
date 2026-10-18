import { createHmac, randomBytes } from 'node:crypto';

/** Thrown for query shapes WooCommerce (PHP) would sign differently, or reserved OAuth keys. */
export class OAuth1Error extends Error {}

/** RFC 3986 percent-encoding, identical to PHP rawurlencode. */
const enc = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// PHP rewrites "." and " " in $_GET keys and parses "[]" as arrays, so such keys would sign differently.
const UNSUPPORTED_KEY = /[[\]. ]/;

function collectQuery(url: URL): Map<string, string> {
  const params = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (UNSUPPORTED_KEY.test(key)) {
      throw new OAuth1Error(`Query key "${key}" is not supported; send lists comma-separated (e.g. include=1,2)`);
    }
    if (key.startsWith('oauth_')) throw new OAuth1Error(`Query key "${key}" is reserved for OAuth`);
    if (params.has(key)) throw new OAuth1Error(`Duplicate query key "${key}"; send lists comma-separated`);
    params.set(key, value);
  }
  return params;
}

/**
 * WooCommerce check_oauth_signature: sort by RAW key in byte order (strcmp), then encode key and value,
 * join with "=" and "&", and build METHOD&enc(baseUri)&enc(normalized).
 */
export function buildOAuth1BaseString(method: string, signingUrl: string, params: ReadonlyMap<string, string>): string {
  const normalized = [...params.entries()]
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  return [method.toUpperCase(), enc(signingUrl), enc(normalized)].join('&');
}

export interface OAuth1SignInput {
  method: string;
  url: string;
  signingBaseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  nonce?: string;
  timestamp?: number;
}

/**
 * Returns the request URL (unchanged host) with OAuth 1.0a one-legged HMAC-SHA256 params.
 * The signature covers signingBaseUrl + path because WooCommerce rebuilds the base URI from
 * get_home_url(), not from the Host header (ADR-005).
 */
export function signOAuth1(input: OAuth1SignInput): URL {
  const target = new URL(input.url);
  const params = collectQuery(target);
  params.set('oauth_consumer_key', input.consumerKey);
  params.set('oauth_nonce', input.nonce ?? randomBytes(16).toString('hex'));
  params.set('oauth_signature_method', 'HMAC-SHA256');
  params.set('oauth_timestamp', String(input.timestamp ?? Math.floor(Date.now() / 1000)));

  const signingUrl = input.signingBaseUrl.replace(/\/+$/, '') + target.pathname;
  const baseString = buildOAuth1BaseString(input.method, signingUrl, params);
  const signature = createHmac('sha256', `${input.consumerSecret}&`).update(baseString).digest('base64');

  const out = new URL(target.origin + target.pathname);
  for (const [k, v] of params) out.searchParams.set(k, v);
  out.searchParams.set('oauth_signature', signature);
  return out;
}
