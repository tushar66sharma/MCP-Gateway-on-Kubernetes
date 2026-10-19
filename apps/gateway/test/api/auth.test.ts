import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureBootstrapAdmin } from '../../src/auth/bootstrap.js';
import { createSession } from '../../src/auth/sessions.js';
import { findUserByEmail, updateUser } from '../../src/auth/users.js';
import { sessions, users } from '../../src/db/schema.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrf, sessionCookieOf, startHarness, type Harness } from '../helpers/harness.js';

type ErrorBody = { error: { code: string; message: string } };

describe('auth api', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const login = (email: string, password: string) => csrf(request(h.baseUrl).post('/api/auth/login')).send({ email, password });

  it('bootstraps the admin only once', async () => {
    const created = await ensureBootstrapAdmin(h.deps.db.db, 'other@example.com', 'another-password', h.deps.logger);
    expect(created).toBe(false);
    const rows = await h.deps.db.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: ADMIN_EMAIL, name: 'Admin', role: 'admin' });
  });

  it('creates the admin when the users table is empty', async () => {
    const empty = await startHarness({ seedAdmin: false });
    try {
      expect(await ensureBootstrapAdmin(empty.deps.db.db, ' Boss@Example.COM ', 'boss-password-1', empty.deps.logger)).toBe(true);
      expect(await ensureBootstrapAdmin(empty.deps.db.db, 'boss@example.com', 'boss-password-1', empty.deps.logger)).toBe(false);
      const rows = await empty.deps.db.db.select().from(users);
      expect(rows.map((r) => r.email)).toEqual(['boss@example.com']);
      expect(empty.logs.join('')).not.toContain('boss-password-1');
    } finally {
      await empty.close();
    }
  });

  it('logs in with an HttpOnly SameSite=Lax cookie without Secure, and me returns the admin', async () => {
    const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect((res.body as { user: unknown }).user).toEqual({ id: expect.any(String), email: ADMIN_EMAIL, name: 'Admin', role: 'admin' });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^ugw_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=43200$/);
    expect(setCookie).not.toContain('Secure');

    const me = await request(h.baseUrl).get('/api/auth/me').set('Cookie', sessionCookieOf(res) ?? '');
    expect(me.status).toBe(200);
    expect((me.body as { user: { email: string; role: string } }).user).toMatchObject({ email: ADMIN_EMAIL, role: 'admin' });
  });

  it('adds Secure when COOKIE_SECURE is true', async () => {
    h.deps.config.COOKIE_SECURE = true;
    const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(String(res.headers['set-cookie'])).toMatch(/; Max-Age=43200; Secure$/);
  });

  it('logs in with a padded, mixed-case email (Review Focus 4)', async () => {
    const res = await login(' Admin@Example.COM ', ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    expect((res.body as { user: { email: string } }).user.email).toBe(ADMIN_EMAIL);
  });

  it('answers the same 401 INVALID_CREDENTIALS for a wrong password, an unknown email and a disabled user', async () => {
    const member = await h.createUser({ email: 'm@example.com', role: 'member', password: 'member-password-9' });
    await h.deps.db.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, member.id));
    for (const [email, password] of [
      [ADMIN_EMAIL, 'wrong-password-1'],
      ['nobody@example.com', ADMIN_PASSWORD],
      ['m@example.com', 'member-password-9'],
    ] as const) {
      const res = await login(email, password);
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('rate limits the 11th attempt with 429 and Retry-After, before checking the password', async () => {
    for (let i = 0; i < 10; i++) expect((await login(ADMIN_EMAIL, `wrong-password-${i}`)).status).toBe(401);
    const res = await login(' ADMIN@example.com', ADMIN_PASSWORD);
    expect(res.status).toBe(429);
    expect((res.body as ErrorBody).error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);

    h.advanceTime(61_000);
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
  });

  it('logs out: deletes the session, clears the cookie, then me is 401', async () => {
    const cookie = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const out = await csrf(request(h.baseUrl).post('/api/auth/logout'), cookie);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^ugw_session=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0$/);
    expect(await h.deps.db.db.select().from(sessions)).toHaveLength(0);
    const me = await request(h.baseUrl).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect((me.body as ErrorBody).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects and deletes an expired session', async () => {
    const cookie = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    h.advanceTime(12 * 3600 * 1000 + 1000);
    expect((await request(h.baseUrl).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect(await h.deps.db.db.select().from(sessions)).toHaveLength(0);
  });

  it('deletes expired sessions on each successful login', async () => {
    await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const member = await h.createUser({ email: 'sweep@example.com', role: 'member', password: 'member-password-7' });
    await h.loginAs('sweep@example.com', 'member-password-7');
    expect(await h.deps.db.db.select().from(sessions)).toHaveLength(2);
    h.advanceTime(12 * 3600 * 1000 + 1000);
    await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    // Both expired rows are gone (the member's too, though never presented again); only the new one remains.
    const rows = await h.deps.db.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).not.toBe(member.id);
  });

  it('never inserts a session for a user disabled after the password check (disable races the login)', async () => {
    const member = await h.createUser({ email: 'race@example.com', role: 'member', password: 'member-password-8' });
    const db = h.deps.db.db;
    // Direct call ordering: the route found the user enabled and verified the password ...
    expect((await findUserByEmail(db, 'race@example.com'))?.disabledAt).toBeNull();
    // ... then an admin's disable commits, then the session insert runs: refused (the route answers 401).
    await updateUser(db, member.id, { disabled: true }, h.deps.clock());
    expect(await createSession(db, member.id, h.deps.clock())).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, member.id))).toEqual([]);
    // Truly concurrent: whichever commits first, no session survives for the disabled user.
    const other = await h.createUser({ email: 'race2@example.com', role: 'member', password: 'member-password-9' });
    await Promise.all([createSession(db, other.id, h.deps.clock()), updateUser(db, other.id, { disabled: true }, h.deps.clock())]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, other.id))).toEqual([]);
  });

  it('answers 401 without a cookie or with an unknown one', async () => {
    expect((await request(h.baseUrl).get('/api/auth/me')).status).toBe(401);
    expect((await request(h.baseUrl).get('/api/auth/me').set('Cookie', 'ugw_session=nope; other=1')).status).toBe(401);
  });

  it('rejects a POST from another Origin with 403 CSRF_REJECTED', async () => {
    const res = await request(h.baseUrl)
      .post('/api/auth/login')
      .set('Origin', 'http://evil.example')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe('CSRF_REJECTED');
  });

  it('rejects a POST without an Origin with 403 CSRF_REJECTED', async () => {
    const res = await request(h.baseUrl).post('/api/auth/login').set('Content-Type', 'application/json').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe('CSRF_REJECTED');
  });

  it('rejects a POST without a JSON content type with 403 CSRF_REJECTED', async () => {
    const res = await request(h.baseUrl)
      .post('/api/auth/login')
      .set('Origin', 'http://app.localhost')
      .type('form')
      .send(`email=${encodeURIComponent(ADMIN_EMAIL)}&password=${ADMIN_PASSWORD}`);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe('CSRF_REJECTED');
  });

  it('checks CSRF before the session on mutating routes', async () => {
    const res = await request(h.baseUrl).post('/api/auth/logout').set('Content-Type', 'application/json');
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).error.code).toBe('CSRF_REJECTED');
  });

  it('never returns password hashes or the session token in a response body, nor logs secrets', async () => {
    const bodies: string[] = [];
    const res = await login(` ${ADMIN_EMAIL.toUpperCase()}`, ADMIN_PASSWORD);
    bodies.push(res.text);
    const cookie = sessionCookieOf(res) ?? '';
    const token = cookie.slice('ugw_session='.length);
    expect(token).toHaveLength(43);
    bodies.push((await request(h.baseUrl).get('/api/auth/me').set('Cookie', cookie)).text);
    bodies.push((await request(h.baseUrl).get('/api/users').set('Cookie', cookie)).text);
    bodies.push((await login(ADMIN_EMAIL, 'wrong-password-x')).text);
    bodies.push((await csrf(request(h.baseUrl).post('/api/auth/logout'), cookie)).text);
    for (const b of bodies) {
      expect(b).not.toContain('password_hash');
      expect(b).not.toContain('passwordHash');
      expect(b).not.toContain('$argon2');
      expect(b).not.toContain(token);
    }
    const logs = h.logs.join('');
    expect(logs).not.toContain(ADMIN_PASSWORD);
    expect(logs).not.toContain('wrong-password-x');
    expect(logs).not.toContain(token);
  });
});
