import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey, revokeApiKey } from '../../src/auth/apiKeys.js';
import { authenticateBearer } from '../../src/auth/bearer.js';
import { mintInternalToken } from '../../src/auth/internalToken.js';
import { createUser, type AuthUser } from '../../src/auth/users.js';
import type { DbHandle } from '../../src/db/client.js';
import { apiKeys, users } from '../../src/db/schema.js';
import { generateApiKey } from '../../src/security/crypto.js';
import { createTestDb } from '../helpers/testDb.js';

const SECRET = 's'.repeat(32);
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('authenticateBearer', () => {
  let h: DbHandle;
  let alice: AuthUser;
  let bob: AuthUser;
  const now = () => new Date();

  beforeAll(async () => {
    h = await createTestDb();
    alice = await createUser(h.db, { email: 'alice@example.com', name: 'Alice', role: 'member', password: 'alice-password-1' });
    bob = await createUser(h.db, { email: 'bob@example.com', name: 'Bob', role: 'member', password: 'bob-password-12' });
  });
  afterAll(async () => {
    await h.close();
  });

  it('returns missing without a header', async () => {
    expect(await authenticateBearer(h.db, undefined, SECRET, now())).toEqual({ ok: false, reason: 'missing', userId: null, apiKeyId: null });
  });

  it('returns unknown with null ids for an unstored ugw_ key', async () => {
    const { plaintext } = generateApiKey();
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toEqual({ ok: false, reason: 'unknown', userId: null, apiKeyId: null });
  });

  it('accepts a valid key as source mcp and sets last_used_at', async () => {
    const { key, plaintext } = await createApiKey(h.db, { userId: alice.id, createdBy: alice.id, name: 'laptop' }, now());
    const res = await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now());
    expect(res).toEqual({ ok: true, user: alice, apiKeyId: key.id, source: 'mcp' });
    const [row] = await h.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('returns revoked with userId and apiKeyId for a revoked key', async () => {
    const { key, plaintext } = await createApiKey(h.db, { userId: alice.id, createdBy: alice.id, name: 'old' }, now());
    expect(await revokeApiKey(h.db, alice.id, key.id, now())).toBe(true);
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toEqual({ ok: false, reason: 'revoked', userId: alice.id, apiKeyId: key.id });
  });

  it('returns disabled for a key of a disabled user', async () => {
    const carol = await createUser(h.db, { email: 'carol@example.com', name: 'Carol', role: 'member', password: 'carol-password-1' });
    const { key, plaintext } = await createApiKey(h.db, { userId: carol.id, createdBy: carol.id, name: 'k' }, now());
    await h.db.update(users).set({ disabledAt: now() }).where(eq(users.id, carol.id));
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toEqual({ ok: false, reason: 'disabled', userId: carol.id, apiKeyId: key.id });
  });

  it('accepts a minted internal token as source chat with a null apiKeyId', async () => {
    const token = await mintInternalToken(bob.id, SECRET);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toEqual({ ok: true, user: bob, apiKeyId: null, source: 'chat' });
  });

  it('returns disabled for an internal token of a user disabled after minting', async () => {
    const dave = await createUser(h.db, { email: 'dave@example.com', name: 'Dave', role: 'member', password: 'dave-password-12' });
    const token = await mintInternalToken(dave.id, SECRET);
    await h.db.update(users).set({ disabledAt: now() }).where(eq(users.id, dave.id));
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toEqual({ ok: false, reason: 'disabled', userId: dave.id, apiKeyId: null });
  });

  it('returns unknown for a token signed with another secret', async () => {
    const token = await mintInternalToken(bob.id, 'o'.repeat(32));
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', userId: null, apiKeyId: null });
  });

  it('returns unknown for a token with another audience', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(bob.id)
      .setAudience('other')
      .setIssuer('urumi-gateway')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('returns unknown for a hand-built alg none token', async () => {
    const t = Math.floor(Date.now() / 1000);
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: bob.id, aud: 'gateway-chat', iss: 'urumi-gateway', iat: t, exp: t + 300 })}.`;
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', userId: null });
  });

  it('returns expired for a token past exp', async () => {
    const token = await mintInternalToken(bob.id, SECRET, 300);
    const later = new Date(Date.now() + 306_000);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, later)).toMatchObject({ ok: false, reason: 'expired', apiKeyId: null });
  });

  it('allows the 5 s clock tolerance on exp', async () => {
    const token = await mintInternalToken(bob.id, SECRET, 300);
    const justAfter = new Date(Date.now() + 302_000);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, justAfter)).toMatchObject({ ok: true, source: 'chat' });
  });

  it('returns unknown for a non-Bearer scheme or garbage', async () => {
    expect(await authenticateBearer(h.db, 'Basic abc', SECRET, now())).toMatchObject({ ok: false, reason: 'unknown' });
    expect(await authenticateBearer(h.db, 'Bearer not-a-jwt', SECRET, now())).toMatchObject({ ok: false, reason: 'unknown' });
  });
});
