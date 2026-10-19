import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticateBearer } from '../../src/auth/bearer.js';
import type { AuthUser } from '../../src/auth/users.js';
import { apiKeys, sessions } from '../../src/db/schema.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrf, startHarness, type Harness } from '../helpers/harness.js';

type ErrorBody = { error: { code: string; message: string } };
interface UserView { id: string; email: string; name: string; role: string; disabled: boolean; createdAt: string }

describe('users api', () => {
  let h: Harness;
  let admin: string;
  let adminUser: AuthUser;
  let member: AuthUser;
  let memberCookie: string;
  beforeEach(async () => {
    h = await startHarness();
    admin = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    adminUser = (((await request(h.baseUrl).get('/api/auth/me').set('Cookie', admin)).body) as { user: AuthUser }).user;
    member = await h.createUser({ email: 'member@example.com', role: 'member', password: 'member-password-1', name: 'Mem' });
    memberCookie = await h.loginAs('member@example.com', 'member-password-1');
  });
  afterEach(async () => {
    await h.close();
  });

  const patch = (id: string, body: object, cookie = admin) => csrf(request(h.baseUrl).patch(`/api/users/${id}`), cookie).send(body);

  it('lists users for an admin as UserView[] and forbids members', async () => {
    const res = await request(h.baseUrl).get('/api/users').set('Cookie', admin);
    expect(res.status).toBe(200);
    const list = res.body as UserView[];
    expect(list.map((u) => u.email).sort()).toEqual([ADMIN_EMAIL, 'member@example.com']);
    expect(list.find((u) => u.id === member.id)).toEqual({ id: member.id, email: 'member@example.com', name: 'Mem', role: 'member', disabled: false, createdAt: expect.any(String) });
    expect(res.text).not.toContain('argon2');

    const forbidden = await request(h.baseUrl).get('/api/users').set('Cookie', memberCookie);
    expect(forbidden.status).toBe(403);
    expect((forbidden.body as ErrorBody).error.code).toBe('FORBIDDEN');
  });

  it('disabling a member kills their session and revokes their keys; enabling does not restore keys', async () => {
    const created = await csrf(request(h.baseUrl).post('/api/keys'), memberCookie).send({ name: 'cli' });
    expect(created.status).toBe(201);
    const { plaintext } = created.body as { plaintext: string };

    const res = await patch(member.id, { disabled: true });
    expect(res.status).toBe(200);
    expect((res.body as { user: UserView }).user).toMatchObject({ id: member.id, disabled: true });

    const me = await request(h.baseUrl).get('/api/auth/me').set('Cookie', memberCookie);
    expect(me.status).toBe(401);
    expect(await h.deps.db.db.select().from(sessions).where(eq(sessions.userId, member.id))).toHaveLength(0);
    const [key] = await h.deps.db.db.select().from(apiKeys).where(eq(apiKeys.userId, member.id));
    expect(key?.revokedAt).toBeInstanceOf(Date);
    // The user is checked before the key, so the audit reason is 'user disabled' while disabled ...
    expect(await authenticateBearer(h.deps.db.db, `Bearer ${plaintext}`, h.deps.config.GATEWAY_INTERNAL_TOKEN_SECRET, h.deps.clock())).toMatchObject({
      ok: false,
      reason: 'disabled',
      userId: member.id,
    });

    const enabled = await patch(member.id, { disabled: false });
    expect((enabled.body as { user: UserView }).user.disabled).toBe(false);
    // ... and 'revoked' after re-enabling: the key stays dead.
    expect(await authenticateBearer(h.deps.db.db, `Bearer ${plaintext}`, h.deps.config.GATEWAY_INTERNAL_TOKEN_SECRET, h.deps.clock())).toMatchObject({
      ok: false,
      reason: 'revoked',
      userId: member.id,
    });
    expect(await h.loginAs('member@example.com', 'member-password-1')).toMatch(/^ugw_session=/);
  });

  it('changes a role', async () => {
    const res = await patch(member.id, { role: 'admin' });
    expect(res.status).toBe(200);
    expect((res.body as { user: UserView }).user.role).toBe('admin');
    expect((await request(h.baseUrl).get('/api/users').set('Cookie', memberCookie)).status).toBe(200);
  });

  it('answers 409 when an admin demotes or disables themself', async () => {
    for (const body of [{ role: 'member' }, { disabled: true }]) {
      const res = await patch(adminUser.id, body);
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).error).toEqual(expect.objectContaining({ code: 'CONFLICT', message: 'You cannot change your own role or disable yourself' }));
    }
    expect((await request(h.baseUrl).get('/api/users').set('Cookie', admin)).status).toBe(200);
  });

  it('answers 404 for an unknown user, 400 for a bad body and 403 for a member', async () => {
    expect((await patch('00000000-0000-4000-8000-000000000000', { disabled: true })).status).toBe(404);
    expect((await patch('nope', { disabled: true })).status).toBe(404);
    expect((await patch(member.id, { role: 'owner' })).status).toBe(400);
    expect((await patch(member.id, { password_hash: 'x' })).status).toBe(400);
    expect((await patch(adminUser.id, { disabled: true }, memberCookie)).status).toBe(403);
  });
});
