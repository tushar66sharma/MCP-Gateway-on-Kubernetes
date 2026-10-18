// OAuth 1.0a (one-legged, HMAC-SHA256) signer + checker for the WooCommerce REST API.
// WooCommerce verifies the signature against get_home_url() — the PUBLIC store URL with
// scheme http when the request is not TLS — not against the URL the request was sent to.
// Usage: node scripts/dev/woo-oauth-check.mjs --target http://127.0.0.1:8088 --sign-base http://store.localhost
//        (consumer key/secret come from env WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET)
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const enc = (s) =>
  encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function signOAuth1Url({ method, requestUrl, signingBaseUrl, consumerKey, consumerSecret, nonce, timestamp }) {
  const target = new URL(requestUrl);
  const signingUrl = new URL(target.pathname, signingBaseUrl); // same path, public host
  const params = {};
  for (const [k, v] of target.searchParams) params[k] = v;
  Object.assign(params, {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
  });
  const normalized = Object.keys(params)
    .map((k) => [enc(k), enc(params[k])])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const baseString = [method.toUpperCase(), enc(signingUrl.origin + signingUrl.pathname), enc(normalized)].join('&');
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
  const path = '/wp-json/wc/v3/products?per_page=5';
  const attempts = [
    ['signed with PUBLIC store URL (expected: 200)', signBase],
    ['signed with the TARGET URL (expected: 401 invalid signature)', target],
  ];
  let ok = true;
  for (const [label, base] of attempts) {
    const url = signOAuth1Url({ method: 'GET', requestUrl: target + path, signingBaseUrl: base, consumerKey: ck, consumerSecret: cs });
    const res = await fetch(url);
    const body = await res.text();
    console.log(`${label}: HTTP ${res.status} ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
    if (base === signBase && res.status !== 200) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
