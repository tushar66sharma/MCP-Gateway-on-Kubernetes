// OAuth 1.0a (one-legged, HMAC-SHA256) signer + checker for the WooCommerce REST API.
// WooCommerce verifies the signature against get_home_url() — the PUBLIC store URL with
// scheme http when the request is not TLS — not against the URL the request was sent to.
// Usage: node scripts/dev/woo-oauth-check.mjs --target http://127.0.0.1:8088 --sign-base http://store.localhost
//        (consumer key/secret come from env WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET)
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const enc = (s) =>
  encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Supported query shape: unique scalar keys only. WooCommerce parses the query with PHP, which
// turns `include[]=1` into an array (signed as include%5B0%5D) and rewrites '.' and ' ' in keys to '_',
// so those shapes cannot be signed faithfully here. Pass lists comma-separated (include=1,2); the
// WP REST API accepts that. Fail loudly rather than send a request that would 401 or silently change.
function collectQueryParams(target) {
  const params = {};
  for (const [k, v] of target.searchParams) {
    if (/[[\]. ]/.test(k)) throw new Error(`unsupported query key "${k}": '[', ']', '.' and spaces are not allowed`);
    if (Object.hasOwn(params, k)) throw new Error(`duplicate query key "${k}": pass lists comma-separated (include=1,2)`);
    params[k] = v;
  }
  return params;
}

// Mirrors WC_REST_Authentication::check_oauth_signature(): sort by RAW key with strcmp (byte order),
// then percent-encode (RFC 3986) keys and values, join "k=v" with '&', and encode the whole string again.
export function buildOAuth1BaseString({ method, requestUrl, signingBaseUrl, consumerKey, nonce, timestamp }) {
  const target = new URL(requestUrl);
  const signingUrl = new URL(target.pathname, signingBaseUrl); // same path, public host
  const params = collectQueryParams(target);
  Object.assign(params, {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
  });
  const normalized = Object.keys(params)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  const baseString = [method.toUpperCase(), enc(signingUrl.origin + signingUrl.pathname), enc(normalized)].join('&');
  return { baseString, params, target };
}

export function signOAuth1Url({ method, requestUrl, signingBaseUrl, consumerKey, consumerSecret, nonce, timestamp }) {
  const { baseString, params, target } = buildOAuth1BaseString({ method, requestUrl, signingBaseUrl, consumerKey, nonce, timestamp });
  const signature = createHmac('sha256', `${consumerSecret}&`).update(baseString).digest('base64');
  const out = new URL(target.origin + target.pathname);
  for (const [k, v] of Object.entries(params)) out.searchParams.set(k, v);
  out.searchParams.set('oauth_signature', signature);
  return out.toString();
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const target = arg('--target');
  const signBase = arg('--sign-base');
  const { WOO_CONSUMER_KEY: ck, WOO_CONSUMER_SECRET: cs } = process.env;
  if (!target || !signBase || !ck || !cs) {
    console.error('usage: WOO_CONSUMER_KEY=.. WOO_CONSUMER_SECRET=.. node woo-oauth-check.mjs --target <url> --sign-base <url>');
    process.exit(2);
  }
  const attempts = [
    // [label, path+query, signing base, expected HTTP status]
    ['signed with PUBLIC store URL (expected: 200)', '/wp-json/wc/v3/products?per_page=5', signBase, 200],
    ['reserved characters in values, PUBLIC URL (expected: 200)', '/wp-json/wc/v3/products?per_page=5&search=mug%20cup&orderby=date', signBase, 200],
    ['signed with the TARGET URL (expected: 401 invalid signature)', '/wp-json/wc/v3/products?per_page=5', target, 401],
  ];
  let ok = true;
  for (const [label, path, base, expected] of attempts) {
    const url = signOAuth1Url({ method: 'GET', requestUrl: target + path, signingBaseUrl: base, consumerKey: ck, consumerSecret: cs });
    const res = await fetch(url);
    const body = await res.text();
    console.log(`${label}: HTTP ${res.status} ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
    if (res.status !== expected) {
      console.error(`FAIL: expected HTTP ${expected} for "${label}"`);
      ok = false;
    }
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
