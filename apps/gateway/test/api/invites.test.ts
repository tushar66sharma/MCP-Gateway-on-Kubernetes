import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invites, users } from '../../src/db/schema.js';
import { sha256Hex } from '../../src/security/crypto.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrf, PUBLIC_APP_URL, sessionCookieOf, startHarness, type Harness } from '../helpers/harness.js';

type ErrorBody = { error: { code: string; message: string } };
interface InviteView { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; expired: boolean }
interface Created { invite: InviteView; link: string }

describe('invites api', () => {
  let h: Harness;
  let admin: string;
  beforeEach(async () => {
    h = await startHarness();
    admin = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  });
  afterEach(async () => {
    await h.close();
  });

  const invite = async (email: string, role: 'admin' | 'member' = 'member') => {
    const res = await csrf(request(h.baseUrl).post('/api/invites'), admin).send({ email, role });
    expect(res.status).toBe(201);
    const body = res.body as Created;
    return { ...body, token: body.link.slice(`${PUBLIC_APP_URL}/invite/`.length) };
  };
  const accept = (token: string, body: object = { name: 'Nina', password: 'nina-password-1' }) =>
    csrf(request(h.baseUrl).post(`/api/invites/${token}/accept`)).send(body);

  it('creates an invite whose link starts with PUBLIC_APP_URL/invite/ and stores only the hash', async () => {
    const res = await csrf(request(h.baseUrl).post('/api/invites'), admin).send({ email: ' Nina@Example.com ', role: 'member' });
    expect(res.status).toBe(201);
    const body = res.body as Created;
    expect(body.link.startsWith(`${PUBLIC_APP_URL}/invite/`)).toBe(true);
    const token = body.link.slice(`${PUBLIC_APP_URL}/invite/`.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.invite).toEqual({ id: expect.any(String), email: 'nina@example.com', role: 'member', expiresAt: expect.any(String), acceptedAt: null, expired: false });
    expect(Date.parse(body.invite.expiresAt) - Date.now()).toBeGreaterThan(71.9 * 3600 * 1000);

    const [row] = await h.deps.db.db.select().from(invites);
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toBe(sha256Hex(token));

    // Shown once: the list never carries the link or the token.
    const list = await request(h.baseUrl).get('/api/invites').set('Cookie', admin);
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(token);
    expect(list.text).not.toContain('/invite/');
    expect(h.logs.join('')).not.toContain(token);
  });

  it('shows a valid invite, accepts it once with a working cookie, then answers 404 INVITE_INVALID', async () => {
    const { token, invite: view } = await invite('nina@example.com');
    const shown = await request(h.baseUrl).get(`/api/invites/${token}`);
    expect(shown.status).toBe(200);
    expect(shown.body).toEqual({ email: 'nina@example.com', role: 'member', expiresAt: view.expiresAt });

    const res = await accept(token);
    expect(res.status).toBe(201);
    expect((res.body as { user: unknown }).user).toEqual({ id: expect.any(String), email: 'nina@example.com', name: 'Nina', role: 'member' });
    const cookie = sessionCookieOf(res);
    expect(cookie).not.toBeNull();
    const me = await request(h.baseUrl).get('/api/auth/me').set('Cookie', cookie ?? '');
    expect((me.body as { user: { email: string } }).user.email).toBe('nina@example.com');
    expect(res.text).not.toContain('$argon2');

    const again = await accept(token, { name: 'Mallory', password: 'mallory-password' });
    expect(again.status).toBe(404);
    expect((again.body as ErrorBody).error.code).toBe('INVITE_INVALID');
    expect((await request(h.baseUrl).get(`/api/invites/${token}`)).status).toBe(404);

    // Accepted invites drop out of the pending list.
    expect((await request(h.baseUrl).get('/api/invites').set('Cookie', admin)).body).toEqual([]);
  });

  it('answers 404 INVITE_INVALID with one message for unknown, expired and used tokens', async () => {
    const unknown = await request(h.baseUrl).get('/api/invites/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
    expect(unknown.status).toBe(404);
    const { token } = await invite('late@example.com');
    h.advanceTime(73 * 3600 * 1000);
    const expired = await request(h.baseUrl).get(`/api/invites/${token}`);
    expect(expired.status).toBe(404);
    expect((expired.body as ErrorBody).error).toMatchObject({ code: 'INVITE_INVALID', message: (unknown.body as ErrorBody).error.message });
    expect((await accept(token)).status).toBe(404);
    expect(await h.deps.db.db.select().from(users)).toHaveLength(1);
  });

  it('lists expired pending invites flagged expired, newest first', async () => {
    await invite('first@example.com');
    h.advanceTime(1000);
    await invite('second@example.com', 'admin');
    h.advanceTime(72 * 3600 * 1000 - 500);
    // The 12 h session has expired by now.
    expect((await request(h.baseUrl).get('/api/invites').set('Cookie', admin)).status).toBe(401);
    admin = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const list = (await request(h.baseUrl).get('/api/invites').set('Cookie', admin)).body as InviteView[];
    expect(list.map((i) => [i.email, i.role, i.expired])).toEqual([
      ['second@example.com', 'admin', false],
      ['first@example.com', 'member', true],
    ]);
  });

  it('answers 409 when inviting an existing user in another case (Review Focus 4)', async () => {
    const res = await csrf(request(h.baseUrl).post('/api/invites'), admin).send({ email: 'ADMIN@example.com', role: 'member' });
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT');
  });

  it('answers 409 on accept when the email has meanwhile become a user', async () => {
    const { token } = await invite('dup@example.com');
    await h.createUser({ email: 'dup@example.com', role: 'member' });
    const res = await accept(token);
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).error.code).toBe('CONFLICT');
  });

  it('validates the accept body', async () => {
    const { token } = await invite('short@example.com');
    expect((await accept(token, { name: 'S', password: 'short' })).status).toBe(400);
    expect((await accept(token, { name: '', password: 'long-enough-pw' })).status).toBe(400);
    expect((await request(h.baseUrl).get(`/api/invites/${token}`)).status).toBe(200);
  });

  it('forbids a member from creating or listing invites', async () => {
    await h.createUser({ email: 'mem@example.com', role: 'member', password: 'member-password-1' });
    const member = await h.loginAs('mem@example.com', 'member-password-1');
    const res = await csrf(request(h.baseUrl).post('/api/invites'), member).send({ email: 'x@example.com', role: 'admin' });
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN');
    expect((await request(h.baseUrl).get('/api/invites').set('Cookie', member)).status).toBe(403);
    expect((await csrf(request(h.baseUrl).post('/api/invites')).send({ email: 'x@example.com', role: 'admin' })).status).toBe(401);
  });

  it('cancels a pending invite with 204, then 404', async () => {
    const { invite: view, token } = await invite('gone@example.com');
    const del = () => csrf(request(h.baseUrl).delete(`/api/invites/${view.id}`), admin);
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(404);
    expect((await csrf(request(h.baseUrl).delete('/api/invites/not-a-uuid'), admin)).status).toBe(404);
    expect((await request(h.baseUrl).get(`/api/invites/${token}`)).status).toBe(404);
  });
});
