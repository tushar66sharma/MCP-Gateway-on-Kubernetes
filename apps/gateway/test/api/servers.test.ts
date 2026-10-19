import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, seededSlugs, upstreamServers } from '../../src/db/schema.js';
import { seedUpstreams } from '../../src/upstreams/seed.js';
import { startFakeUpstream, type FakeUpstream } from '../helpers/fakeUpstream.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrf, startHarness, type Harness } from '../helpers/harness.js';

const CRED = 's3cr3t-cred-value-xyz';

interface ServerView {
  id: string;
  slug: string;
  name: string;
  url: string;
  authType: string;
  authHeaderName: string | null;
  hasCredential: boolean;
  enabled: boolean;
  status: string;
  lastError: string | null;
  checkedAt: string | null;
  toolCount: number;
  tools: { name: string; description: string }[];
  skippedTools: string[];
}
type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

describe('servers api', () => {
  let fake: FakeUpstream;
  let h: Harness;
  let admin: string;
  let memberCookie: string;
  /** Every response body of the test, raw, for the plaintext check. */
  let seen: string[];

  beforeAll(async () => {
    fake = await startFakeUpstream({ name: 'fake', tools: ['ping', 'echo'], auth: { kind: 'bearer', token: CRED } });
  });
  afterAll(async () => {
    await fake.stop();
  });
  beforeEach(async () => {
    seen = [];
    h = await startHarness();
    admin = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    await h.createUser({ email: 'member@example.com', role: 'member', password: 'member-password-1' });
    memberCookie = await h.loginAs('member@example.com', 'member-password-1');
  });
  afterEach(async () => {
    await h.close();
  });

  const keep = (res: request.Response) => {
    seen.push(res.text ?? '', JSON.stringify(res.headers));
    return res;
  };
  const post = async (body: unknown, cookie = admin) => keep(await csrf(request(h.baseUrl).post('/api/servers'), cookie).send(body as object));
  const patch = async (id: string, body: unknown) => keep(await csrf(request(h.baseUrl).patch(`/api/servers/${id}`), admin).send(body as object));
  const get = async (path: string, cookie = admin) => keep(await request(h.baseUrl).get(path).set('Cookie', cookie));
  const refresh = async (id: string) => keep(await csrf(request(h.baseUrl).post(`/api/servers/${id}/refresh`), admin));
  const valid = () => ({ slug: 'fake', name: 'Fake Server', url: fake.url, authType: 'bearer', credential: CRED });

  it('creates a server with an encrypted credential that never appears in any response', async () => {
    const created = await post(valid());
    expect(created.status).toBe(201);
    const view = created.body as ServerView;
    expect(view).toMatchObject({ slug: 'fake', name: 'Fake Server', url: fake.url, authType: 'bearer', authHeaderName: null, hasCredential: true, enabled: true, status: 'connected', lastError: null, toolCount: 2, skippedTools: [] });
    expect(view.tools).toEqual([
      { name: 'fake__echo', description: '[Fake Server] fake echo' },
      { name: 'fake__ping', description: '[Fake Server] fake ping' },
    ]);
    expect(view.checkedAt).toEqual(expect.any(String));
    expect(h.deps.upstreams.listTools().map((t) => t.name)).toEqual(['fake__echo', 'fake__ping']);

    const list = await get('/api/servers', memberCookie);
    expect(list.status).toBe(200);
    expect((list.body as ServerView[]).map((s) => s.slug)).toEqual(['fake']);
    expect((await get(`/api/servers/${view.id}`, memberCookie)).body).toMatchObject({ id: view.id, hasCredential: true, status: 'connected' });
    expect((await patch(view.id, { name: 'Renamed' })).status).toBe(200);
    expect((await refresh(view.id)).status).toBe(200);
    const audit = await get('/api/audit');
    expect(audit.status).toBe(200);

    for (const body of seen) expect(body).not.toContain(CRED);
    const [row] = await h.deps.db.db.select().from(upstreamServers).where(eq(upstreamServers.id, view.id));
    expect(row?.credentialEnc).toBeInstanceOf(Buffer);
    expect(row!.credentialEnc!.toString('utf8')).not.toContain(CRED);
    expect(row!.credentialEnc!.toString('latin1')).not.toContain(CRED);
    expect(h.logs.join('')).not.toContain(CRED);
  });

  it('forbids members from changing servers', async () => {
    expect((await post(valid(), memberCookie)).status).toBe(403);
    const created = (await post(valid())).body as ServerView;
    expect((await csrf(request(h.baseUrl).patch(`/api/servers/${created.id}`), memberCookie).send({ name: 'x' })).status).toBe(403);
    expect((await csrf(request(h.baseUrl).delete(`/api/servers/${created.id}`), memberCookie)).status).toBe(403);
    expect((await csrf(request(h.baseUrl).post(`/api/servers/${created.id}/refresh`), memberCookie)).status).toBe(403);
    expect((await request(h.baseUrl).get('/api/servers')).status).toBe(401);
  });

  it('validates the body', async () => {
    const bad = await post({ ...valid(), slug: 'bad slug' });
    expect(bad.status).toBe(400);
    expect((bad.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    const cases: Record<string, unknown>[] = [
      { ...valid(), slug: 'Upper' },
      { ...valid(), slug: 'a_b' },
      { ...valid(), name: '' },
      { ...valid(), name: 'x'.repeat(101) },
      { ...valid(), credential: '' },
      { ...valid(), credential: 'x'.repeat(4097) },
      { ...valid(), authType: 'basic' },
      { ...valid(), authType: 'none' },
      { ...valid(), authType: 'header' },
      { ...valid(), authType: 'header', authHeaderName: 'Authorization' },
      { ...valid(), authType: 'header', authHeaderName: 'cookie' },
      { ...valid(), authType: 'header', authHeaderName: 'Host' },
      { ...valid(), authType: 'header', authHeaderName: 'x key' },
      { ...valid(), authType: 'bearer', authHeaderName: 'x-key' },
      { ...valid(), extra: true },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(Object.keys(body))).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    }
    for (const body of seen) expect(body).not.toContain(CRED);
  });

  it('accepts header auth with a safe header name', async () => {
    const res = await post({ slug: 'hdr', name: 'Header', url: fake.url, authType: 'header', authHeaderName: 'x-utilities-key', credential: CRED });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ authType: 'header', authHeaderName: 'x-utilities-key', hasCredential: true });
  });

  it('rejects unsafe URLs with SSRF_REJECTED', async () => {
    const res = await post({ ...valid(), url: 'http://169.254.169.254/mcp' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'SSRF_REJECTED', details: { reason: 'link_local' } } });
    const scheme = await post({ ...valid(), url: 'file:///etc/passwd' });
    expect(scheme.status).toBe(400);
    expect((scheme.body as ErrorBody).error.code).toMatch(/^(SSRF_REJECTED|VALIDATION_FAILED)$/);
    expect(await h.deps.db.db.select().from(upstreamServers)).toEqual([]);
  });

  it('answers 409 for a duplicate slug', async () => {
    expect((await post(valid())).status).toBe(201);
    const dup = await post({ ...valid(), name: 'Other' });
    expect(dup.status).toBe(409);
    expect((dup.body as ErrorBody).error.code).toBe('CONFLICT');
  });

  it('keeps the credential on a PATCH without one, and clears it with clearCredential', async () => {
    const { id } = (await post(valid())).body as ServerView;
    const kept = await patch(id, { name: 'Renamed', enabled: true });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ name: 'Renamed', hasCredential: true, status: 'connected' });

    const cleared = await patch(id, { credential: '', clearCredential: true });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ hasCredential: false, status: 'unreachable', lastError: 'HTTP 401 from upstream' });
    const [row] = await h.deps.db.db.select().from(upstreamServers).where(eq(upstreamServers.id, id));
    expect(row?.credentialEnc).toBeNull();

    const rotated = await patch(id, { credential: CRED });
    expect(rotated.body).toMatchObject({ hasCredential: true, status: 'connected' });
    for (const body of seen) expect(body).not.toContain(CRED);
  });

  it('disables and re-enables a server', async () => {
    const { id } = (await post(valid())).body as ServerView;
    expect((await patch(id, { enabled: false })).body).toMatchObject({ enabled: false, status: 'disabled', toolCount: 0, tools: [] });
    expect(h.deps.upstreams.listTools()).toEqual([]);
    expect((await patch(id, { enabled: true })).body).toMatchObject({ enabled: true, status: 'connected', toolCount: 2 });
  });

  it('rejects a slug change and unsafe PATCH bodies', async () => {
    const { id } = (await post(valid())).body as ServerView;
    const slug = await patch(id, { slug: 'other' });
    expect(slug.status).toBe(400);
    expect(slug.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'slug cannot be changed' } });
    expect((await patch(id, { url: 'http://169.254.169.254/mcp' })).body).toMatchObject({ error: { code: 'SSRF_REJECTED' } });
    expect((await patch(id, { authType: 'none', credential: 'abc' })).status).toBe(400);
    expect((await patch(id, { authType: 'header' })).status).toBe(400);
    expect((await patch(id, { credential: 'abc', clearCredential: true })).status).toBe(400);
    expect((await patch(id, { credential: '' })).status).toBe(400);
    expect((await patch('00000000-0000-4000-8000-000000000000', { name: 'x' })).status).toBe(404);
    expect((await get('/api/servers/not-a-uuid')).status).toBe(404);
    expect((await get('/api/servers/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('drops the credential when switching to authType none', async () => {
    const { id } = (await post(valid())).body as ServerView;
    const res = await patch(id, { authType: 'none' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authType: 'none', hasCredential: false });
  });

  it('refreshes a server on demand', async () => {
    const { id } = (await post(valid())).body as ServerView;
    const res = await refresh(id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'connected', toolCount: 2 });
    expect((await csrf(request(h.baseUrl).post('/api/servers/00000000-0000-4000-8000-000000000000/refresh'), admin)).status).toBe(404);
  });

  it('deletes a server with 204; its audit rows remain with the slug kept', async () => {
    const { id } = (await post(valid())).body as ServerView;
    await h.deps.audit.record({
      event: 'tool_call',
      source: 'mcp',
      userId: null,
      apiKeyId: null,
      serverId: id,
      serverSlug: 'fake',
      toolName: 'ping',
      startedAt: new Date(),
      durationMs: 3,
      outcome: 'success',
      errorMessage: null,
    });
    const del = await csrf(request(h.baseUrl).delete(`/api/servers/${id}`), admin);
    expect(del.status).toBe(204);
    expect((await get(`/api/servers/${id}`)).status).toBe(404);
    expect(h.deps.upstreams.listTools()).toEqual([]);
    const rows = await h.deps.db.db.select().from(auditLogs).where(eq(auditLogs.serverSlug, 'fake'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serverId: null, serverSlug: 'fake', toolName: 'ping' });
    expect((await csrf(request(h.baseUrl).delete(`/api/servers/${id}`), admin)).status).toBe(404);
  });

  it('a deleted built-in (seeded) server stays deleted when the seeds run again, and can be re-added', async () => {
    const seeds = [{ slug: 'fake', name: 'Fake Server', url: fake.url, authType: 'bearer' as const, credentialEnv: 'SEED_FAKE' }];
    const seedEnv = { SEED_FAKE: CRED };
    const runSeeds = () => seedUpstreams(h.deps.db.db, seeds, seedEnv, h.deps.config.GATEWAY_ENCRYPTION_KEY, h.deps.logger);
    expect((await runSeeds()).inserted).toEqual(['fake']);
    const row = (await h.deps.repo.getBySlug('fake'))!;
    expect((await csrf(request(h.baseUrl).delete(`/api/servers/${row.id}`), admin)).status).toBe(204);
    // A restart runs the seeds again: DELETE left seeded_slugs alone, so nothing comes back.
    expect(await runSeeds()).toEqual({ inserted: [], skipped: ['fake'], marked: [] });
    expect(await h.deps.repo.getBySlug('fake')).toBeNull();
    expect((await h.deps.db.db.select().from(seededSlugs)).map((r) => r.slug)).toEqual(['fake']);
    // The documented way back: POST /api/servers.
    expect((await post(valid())).status).toBe(201);
    expect(h.deps.upstreams.listTools().map((t) => t.name)).toEqual(['fake__echo', 'fake__ping']);
  });
});
