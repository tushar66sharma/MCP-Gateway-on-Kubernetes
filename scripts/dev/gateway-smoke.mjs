// End-to-end smoke test for the gateway: login, personal API key, aggregated /mcp, optional writes,
// optional upstream isolation, key revocation and the audit log.
// Usage: GATEWAY_ADMIN_EMAIL=... GATEWAY_ADMIN_PASSWORD=... node scripts/dev/gateway-smoke.mjs \
//          --base http://app.localhost [--write] [--isolation]
// The password, the session cookie and the API key are held in memory only and never printed.
import { execFileSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (argValue('--base') ?? '').replace(/\/+$/, '');
const write = args.includes('--write');
const isolation = args.includes('--isolation');
const email = process.env.GATEWAY_ADMIN_EMAIL;
const password = process.env.GATEWAY_ADMIN_PASSWORD;
if (!base || !email || !password) {
  console.error('usage: GATEWAY_ADMIN_EMAIL=<email> GATEWAY_ADMIN_PASSWORD=<password> node scripts/dev/gateway-smoke.mjs --base <url> [--write] [--isolation]');
  process.exit(1);
}
const origin = new URL(base).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1);

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

let cookie = '';
let apiKey = '';

/** A JSON request to /api with the session cookie and the CSRF headers. */
async function api(method, path, body) {
  const headers = { Origin: origin, Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  else if (method !== 'GET') headers['Content-Type'] = 'application/json';
  return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
}

/** Runs fn with a fresh MCP client (a new session each time keeps the polling independent). */
async function withClient(fn) {
  const client = new Client({ name: 'gateway-smoke', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } }),
  );
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

const listToolNames = () => withClient(async (c) => (await c.listTools()).tools.map((t) => t.name));

async function call(client, name, argumentsObj) {
  const res = await client.callTool({ name, arguments: argumentsObj });
  if (res.isError) {
    const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(' ').slice(0, 300);
    throw new Error(`${name} returned an error: ${text}`);
  }
  return res;
}

const textOf = (res) => (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(' ');

async function pollTools(predicate, timeoutMs) {
  const t0 = Date.now();
  let last = [];
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = await listToolNames();
      if (predicate(last)) return { names: last, seconds: secs(t0) };
    } catch {
      // the gateway may be busy; try again
    }
    await sleep(2000);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for the tool list to change (utils__ tools present: ${last.some((n) => n.startsWith('utils__'))})`);
}

const kubectl = (...a) => execFileSync('kubectl', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const RESTORE_CMD = 'kubectl -n mcp scale deploy/mcp-utilities --replicas=1';
let utilsScaledDown = false;
let keyId = null;
let keyRevoked = false;

/** Scales mcp-utilities back to 1 (synchronous so signal handlers can use it). One retry, then a loud error. */
function restoreUtilities() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      kubectl('-n', 'mcp', 'scale', 'deploy/mcp-utilities', '--replicas=1');
      utilsScaledDown = false;
      return true;
    } catch {
      // retry once
    }
  }
  console.error(`ERROR: could not scale mcp-utilities back to 1 replica. Run this by hand NOW: ${RESTORE_CMD}`);
  process.exitCode = 1;
  return false;
}

/** Revokes the smoke key once; a non-204 prints a warning naming the key id (never the key). */
async function revokeKey() {
  if (!keyId || keyRevoked) return;
  try {
    const res = await api('DELETE', `/api/keys/${keyId}`);
    if (res.status === 204) {
      keyRevoked = true;
    } else {
      console.error(`WARNING: revoking the smoke API key ${keyId} returned HTTP ${res.status}. Revoke it with DELETE /api/keys/${keyId} (see docs/run-guide.md).`);
    }
  } catch (err) {
    console.error(`WARNING: could not revoke the smoke API key ${keyId} (${err instanceof Error ? err.name : 'error'}). Revoke it with DELETE /api/keys/${keyId} (see docs/run-guide.md).`);
  }
}

/** Ends the smoke session (each run used to leave a session row behind until it expired). */
async function logout() {
  if (!cookie) return;
  try {
    const res = await api('POST', '/api/auth/logout');
    if (res.status === 204) cookie = '';
    else console.error(`WARNING: logout returned HTTP ${res.status}; the session expires on its own within 12 h.`);
  } catch (err) {
    console.error(`WARNING: logout failed (${err instanceof Error ? err.name : 'error'}); the session expires on its own within 12 h.`);
  }
}

let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) return;
    interrupted = true;
    console.error(`${sig}: cleaning up`);
    if (utilsScaledDown) restoreUtilities();
    void revokeKey()
      .then(logout)
      .finally(() => process.exit(130));
  });
}

let utilsRestoredAtStart = false;
let failed = false;
try {
  // Self-heal a previous aborted --isolation run: mcp-utilities must be at 1 replica and ready.
  if (isolation) {
    const replicas = kubectl('-n', 'mcp', 'get', 'deploy/mcp-utilities', '-o', 'jsonpath={.spec.replicas}').trim();
    if (replicas !== '1') {
      kubectl('-n', 'mcp', 'scale', 'deploy/mcp-utilities', '--replicas=1');
      utilsRestoredAtStart = true;
      console.log(`isolation: mcp-utilities was at ${replicas || '?'} replicas (aborted earlier run?); restored to 1`);
    }
    kubectl('-n', 'mcp', 'rollout', 'status', 'deploy/mcp-utilities', '--timeout=120s');
  }

  // 1. Log in. Only the name=value pair of the session cookie is kept.
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  assert(login.status === 200, `login returned HTTP ${login.status}`);
  const setCookie = login.headers.getSetCookie().find((c) => c.startsWith('ugw_session='));
  assert(setCookie, 'login did not set the ugw_session cookie');
  cookie = setCookie.split(';')[0];
  const me = await (await api('GET', '/api/auth/me')).json();
  assert(me.user?.email === email.trim().toLowerCase(), 'session user is not the admin');
  console.log(`login: ok (role=${me.user.role})`);

  // 2. A personal API key, in memory only.
  const keyName = `gateway-smoke ${new Date().toISOString()}`;
  const created = await api('POST', '/api/keys', { name: keyName });
  assert(created.status === 201, `create key returned HTTP ${created.status}`);
  const createdBody = await created.json();
  apiKey = createdBody.plaintext;
  keyId = createdBody.key?.id;
  assert(typeof apiKey === 'string' && /^ugw_[0-9A-Za-z]{43}$/.test(apiKey), 'key plaintext has an unexpected shape');
  assert(typeof keyId === 'string', 'key id missing');
  console.log('api key: created (not printed)');

  // 3. tools/list: 15 tools, 6 woo__, 5 notes__, 4 utils__.
  const names = utilsRestoredAtStart ? (await pollTools((n) => n.length === 15, 60000)).names : await listToolNames();
  const count = (p) => names.filter((n) => n.startsWith(p)).length;
  assert(names.length === 15, `expected 15 tools, got ${names.length}: ${names.join(', ')}`);
  assert(count('woo__') === 6 && count('notes__') === 5 && count('utils__') === 4, `unexpected split woo=${count('woo__')} notes=${count('notes__')} utils=${count('utils__')}`);
  console.log(`tools (15): woo=${count('woo__')} notes=${count('notes__')} utils=${count('utils__')}`);

  // 4. Calls.
  await withClient(async (c) => {
    for (const t of ['utils__ping', 'notes__ping', 'woo__ping']) {
      const r = await call(c, t, {});
      assert(r.structuredContent?.ok === true, `${t} did not return ok=true`);
      console.log(`${t}: ok`);
    }
    const orders = await call(c, 'woo__list_orders', { period: 'today' });
    assert(Array.isArray(orders.structuredContent?.orders), 'woo__list_orders did not return an orders array');
    console.log(`woo__list_orders today: ${orders.structuredContent.orders.length} order(s)`);
    const calc = await call(c, 'utils__calculate', { expression: '2+3*4' });
    assert(calc.structuredContent?.result === 14, `utils__calculate returned ${JSON.stringify(calc.structuredContent?.result)}`);
    console.log('utils__calculate 2+3*4: 14');

    // 5. Writes.
    if (write) {
      const note = await call(c, 'notes__create_note', { title: 'Gateway smoke', content: new Date().toISOString() });
      assert(typeof note.structuredContent?.note?.id === 'number', 'notes__create_note did not return a note id');
      console.log(`notes__create_note: id=${note.structuredContent.note.id}`);
      const found = await call(c, 'notes__search_notes', { query: 'Gateway smoke' });
      assert((found.structuredContent?.count ?? 0) >= 1, 'notes__search_notes found nothing');
      console.log(`notes__search_notes: ${found.structuredContent.count} found`);
    }
  });

  // 6. Isolation: one upstream down must not affect the others.
  if (isolation) {
    const t0 = Date.now();
    kubectl('-n', 'mcp', 'scale', 'deploy/mcp-utilities', '--replicas=0');
    utilsScaledDown = true;
    console.log('isolation: mcp-utilities scaled to 0');
    try {
      const gone = await pollTools((n) => !n.some((x) => x.startsWith('utils__')), 45000);
      console.log(`isolation: utils__ tools gone after ${gone.seconds}s (${gone.names.length} tools left)`);
      assert(gone.names.some((n) => n.startsWith('woo__')) && gone.names.some((n) => n.startsWith('notes__')), 'woo/notes tools disappeared with utils');
      await withClient(async (c) => {
        const r = await call(c, 'woo__ping', {});
        assert(r.structuredContent?.ok === true, 'woo__ping failed while utils was down');
      });
      console.log('isolation: woo__ping still ok while utils is down');
    } finally {
      const t1 = Date.now();
      if (!restoreUtilities()) throw new Error('could not restore mcp-utilities');
      console.log('isolation: mcp-utilities scaled back to 1');
      const back = await pollTools((n) => n.filter((x) => x.startsWith('utils__')).length === 4, 90000);
      console.log(`isolation: utils__ tools back after ${secs(t1)}s (${back.names.length} tools; total ${secs(t0)}s)`);
    }
  }

  // 7. Revoke the key, expect 401 on /mcp, then the audit rows.
  const del = await api('DELETE', `/api/keys/${keyId}`);
  assert(del.status === 204, `revoke key returned HTTP ${del.status}`);
  keyRevoked = true;
  const after = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    redirect: 'manual',
  });
  assert(after.status === 401, `tools/list with the revoked key returned HTTP ${after.status}, expected 401`);
  const afterBody = await after.json().catch(() => ({}));
  assert(afterBody.error?.code === -32001, 'the 401 body is not JSON-RPC -32001');
  console.log('revoked key: /mcp answers 401 (-32001)');

  const auditRes = await api('GET', '/api/audit?limit=20');
  assert(auditRes.status === 200, `audit returned HTTP ${auditRes.status}`);
  const audit = await auditRes.json();
  const mine = audit.items.filter((r) => r.userEmail === email.trim().toLowerCase());
  assert(mine.length > 0, 'no audit rows attributed to the admin');
  const slugs = [...new Set(mine.map((r) => r.serverSlug).filter(Boolean))].sort();
  // Every run calls ping on all three servers, so all three must appear in the admin's audit rows.
  for (const s of ['utils', 'notes', 'woo']) assert(slugs.includes(s), `audit rows by the admin do not include server ${s}`);
  console.log(`audit: ${audit.items.length} row(s), ${mine.length} by the admin; servers=[${slugs.join(',')}]`);
  for (const r of mine.slice(0, 8)) console.log(`  ${r.event} ${r.serverSlug ?? '-'} ${r.toolName ?? '-'} ${r.outcome} ${r.durationMs}ms`);

  console.log('Gateway smoke test passed.');
} catch (err) {
  console.error(`Gateway smoke test FAILED: ${err instanceof Error ? err.message : String(err)}`);
  failed = true;
} finally {
  if (utilsScaledDown) restoreUtilities();
  await revokeKey();
  await logout();
}
if (failed || process.exitCode) process.exit(1);
