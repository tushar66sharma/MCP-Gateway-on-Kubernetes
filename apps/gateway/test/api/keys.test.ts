import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiKey } from '../../src/auth/apiKeys.js';
import { authenticateBearer } from '../../src/auth/bearer.js';
import { updateUser, type AuthUser } from '../../src/auth/users.js';
import { apiKeys } from '../../src/db/schema.js';
import { sha256Hex } from '../../src/security/crypto.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrf, startHarness, type Harness } from '../helpers/harness.js';

type ErrorBody = { error: { code: string } };
interface KeyView { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
interface Created { key: KeyView; plaintext: string }

describe('keys api', () => {
  let h: Harness;
  let admin: string;
  let adminUser: AuthUser;
  let member: AuthUser;
  let memberCookie: string;
  beforeEach(async () => {
    h = await startHarness();
    admin = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminUser = ((await request(h.baseUrl).get('/api/auth/me').set('Cookie', admin)).body as { user: AuthUser }).user;
    member = await h.createUser({ email: 'member@example.com', role: 'member', password: 'member-password-1' });
    memberCookie = await h.loginAs('member@example.com', 'member-password-1');
  });
  afterEach(async () => {
    await h.close();
  });

  const create = async (cookie: string, name: string) => {
    const res = await csrf(request(h.baseUrl).post('/api/keys'), cookie).send({ name });
    expect(res.status).toBe(201);
    return res.body as Created;
  };
  const bearer = (plaintext: string) => authenticateBearer(h.deps.db.db, `Bearer ${plaintext}`, h.deps.config.GATEWAY_INTERNAL_TOKEN_SECRET, h.deps.clock());

  it('creates a key shown once; the DB holds only sha256(plaintext) and the prefix', async () => {
    const { key, plaintext } = await create(memberCookie, 'Claude Code');
    expect(plaintext).toMatch(/^ugw_[0-9A-Za-z]{43}$/);
    expect(key).toEqual({ id: expect.any(String), name: 'Claude Code', prefix: plaintext.slice(0, 12), createdAt: expect.any(String), lastUsedAt: null, revokedAt: null });

    const [row] = await h.deps.db.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row).toMatchObject({ userId: member.id, createdBy: member.id, prefix: plaintext.slice(0, 12), keyHash: sha256Hex(plaintext) });
    expect(JSON.stringify(row)).not.toContain(plaintext);
    expect(h.logs.join('')).not.toContain(plaintext);
  });

  it('lists own keys newest first without plaintext or hashes', async () => {
    const a = await create(memberCookie, 'first');
    h.advanceTime(1000);
    const b = await create(memberCookie, 'second');
    await create(admin, 'admin-key');
    const res = await request(h.baseUrl).get('/api/keys').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect((res.body as KeyView[]).map((k) => k.name)).toEqual(['second', 'first']);
    for (const p of [a.plaintext, b.plaintext]) expect(res.text).not.toContain(p);
    expect(res.text).not.toContain(sha256Hex(a.plaintext));
    expect(res.text).not.toMatch(/key_?hash/i);
  });

  it('revokes an own key: 204, then bearer auth gives revoked with the userId', async () => {
    const { key, plaintext } = await create(memberCookie, 'cli');
    expect((await bearer(plaintext)).ok).toBe(true);
    const res = await csrf(request(h.baseUrl).delete(`/api/keys/${key.id}`), memberCookie);
    expect(res.status).toBe(204);
    expect(await bearer(plaintext)).toEqual({ ok: false, reason: 'revoked', userId: member.id, apiKeyId: key.id, recognised: true, source: 'mcp' });
    const list = (await request(h.baseUrl).get('/api/keys').set('Cookie', memberCookie)).body as KeyView[];
    expect(list[0]?.revokedAt).toEqual(expect.any(String));
    expect(list[0]?.lastUsedAt).toEqual(expect.any(String));
  });

  it("answers 404 when a member deletes another user's key", async () => {
    const { key, plaintext } = await create(admin, 'admin-only');
    const res = await csrf(request(h.baseUrl).delete(`/api/keys/${key.id}`), memberCookie);
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND');
    expect((await bearer(plaintext)).ok).toBe(true);
    expect((await csrf(request(h.baseUrl).delete('/api/keys/not-a-uuid'), memberCookie)).status).toBe(404);
  });

  it('lets an admin issue, list and revoke keys for a member', async () => {
    const res = await csrf(request(h.baseUrl).post(`/api/users/${member.id}/keys`), admin).send({ name: 'issued' });
    expect(res.status).toBe(201);
    const { key, plaintext } = res.body as Created;
    const [row] = await h.deps.db.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row).toMatchObject({ userId: member.id, createdBy: adminUser.id });
    expect(await bearer(plaintext)).toMatchObject({ ok: true, user: { id: member.id } });

    const list = await request(h.baseUrl).get(`/api/users/${member.id}/keys`).set('Cookie', admin);
    expect((list.body as KeyView[]).map((k) => k.id)).toEqual([key.id]);
    expect((await request(h.baseUrl).get('/api/keys').set('Cookie', memberCookie)).body).toHaveLength(1);

    // The key must belong to the user in the path.
    expect((await csrf(request(h.baseUrl).delete(`/api/users/${adminUser.id}/keys/${key.id}`), admin)).status).toBe(404);
    expect((await csrf(request(h.baseUrl).delete(`/api/users/${member.id}/keys/${key.id}`), admin)).status).toBe(204);
    expect(await bearer(plaintext)).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('answers 404 for keys of an unknown user and 403 for a member', async () => {
    expect((await request(h.baseUrl).get('/api/users/00000000-0000-4000-8000-000000000000/keys').set('Cookie', admin)).status).toBe(404);
    expect((await csrf(request(h.baseUrl).post('/api/users/00000000-0000-4000-8000-000000000000/keys'), admin).send({ name: 'x' })).status).toBe(404);
    expect((await request(h.baseUrl).get(`/api/users/${member.id}/keys`).set('Cookie', memberCookie)).status).toBe(403);
    expect((await csrf(request(h.baseUrl).post(`/api/users/${adminUser.id}/keys`), memberCookie).send({ name: 'x' })).status).toBe(403);
  });

  it('refuses to issue a key for a disabled user (409) or for another admin (403); an admin may for self', async () => {
    const issue = (userId: string) => csrf(request(h.baseUrl).post(`/api/users/${userId}/keys`), admin).send({ name: 'issued' });
    await updateUser(h.deps.db.db, member.id, { disabled: true }, h.deps.clock());
    const disabled = await issue(member.id);
    expect(disabled.status).toBe(409);
    expect((disabled.body as ErrorBody).error.code).toBe('CONFLICT');

    const other = await h.createUser({ email: 'admin2@example.com', role: 'admin' });
    const forbidden = await issue(other.id);
    expect(forbidden.status).toBe(403);
    expect((forbidden.body as ErrorBody).error.code).toBe('FORBIDDEN');
    expect(await h.deps.db.db.select().from(apiKeys)).toEqual([]);

    const own = await issue(adminUser.id);
    expect(own.status).toBe(201);
    expect(await bearer((own.body as Created).plaintext)).toMatchObject({ ok: true, user: { id: adminUser.id } });
  });

  it('never inserts a key for a user disabled after the route checked it (disable races the insert)', async () => {
    // Direct call ordering: the route's checks passed, then the disable commits, then the insert runs.
    await updateUser(h.deps.db.db, member.id, { disabled: true }, h.deps.clock());
    expect(await createApiKey(h.deps.db.db, { userId: member.id, createdBy: adminUser.id, name: 'late' }, h.deps.clock())).toBeNull();
    // Truly concurrent: whichever commits first, no live key is left for the disabled user.
    const carol = await h.createUser({ email: 'carol@example.com', role: 'member' });
    await Promise.all([
      createApiKey(h.deps.db.db, { userId: carol.id, createdBy: adminUser.id, name: 'racing' }, h.deps.clock()),
      updateUser(h.deps.db.db, carol.id, { disabled: true }, h.deps.clock()),
    ]);
    const live = (await h.deps.db.db.select().from(apiKeys).where(eq(apiKeys.userId, carol.id))).filter((k) => k.revokedAt === null);
    expect(live).toEqual([]);
    expect((await h.deps.db.db.select().from(apiKeys).where(eq(apiKeys.userId, member.id))).length).toBe(0);
  });

  it('validates the key name', async () => {
    expect((await csrf(request(h.baseUrl).post('/api/keys'), memberCookie).send({ name: '' })).status).toBe(400);
    expect((await csrf(request(h.baseUrl).post('/api/keys'), memberCookie).send({ name: 'x'.repeat(61) })).status).toBe(400);
    expect((await request(h.baseUrl).get('/api/keys')).status).toBe(401);
  });
});
