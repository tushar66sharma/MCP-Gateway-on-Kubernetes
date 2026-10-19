import { randomUUID } from 'node:crypto';
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
  const newKey = async (userId: string, name: string) => (await createApiKey(h.db, { userId, createdBy: userId, name }, now()))!;

  beforeAll(async () => {
    h = await createTestDb();
    alice = await createUser(h.db, { email: 'alice@example.com', name: 'Alice', role: 'member', password: 'alice-password-1' });
    bob = await createUser(h.db, { email: 'bob@example.com', name: 'Bob', role: 'member', password: 'bob-password-12' });
  });
  afterAll(async () => {
    await h.close();
  });

  it('returns missing without a header (not recognisable)', async () => {
    expect(await authenticateBearer(h.db, undefined, SECRET, now())).toEqual({ ok: false, reason: 'missing', userId: null, apiKeyId: null, recognised: false, source: 'mcp' });
  });

  it('returns unknown with null ids for an unstored, well-formed ugw_ key (recognisable)', async () => {
    const { plaintext } = generateApiKey();
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toEqual({ ok: false, reason: 'unknown', userId: null, apiKeyId: null, recognised: true, source: 'mcp' });
  });

  it('returns unknown, not recognisable, for a malformed ugw_ value', async () => {
    for (const v of ['ugw_short', `ugw_${'A'.repeat(42)}`, `ugw_${'A'.repeat(44)}`, `ugw_${'A'.repeat(42)}!`]) {
      expect(await authenticateBearer(h.db, `Bearer ${v}`, SECRET, now()), v).toMatchObject({ ok: false, reason: 'unknown', recognised: false });
    }
  });

  it('accepts a valid key as source mcp and sets last_used_at', async () => {
    const { key, plaintext } = await newKey(alice.id, 'laptop');
    const res = await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now());
    expect(res).toEqual({ ok: true, user: alice, apiKeyId: key.id, source: 'mcp' });
    const [row] = await h.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('returns revoked with userId and apiKeyId for a revoked key', async () => {
    const { key, plaintext } = await newKey(alice.id, 'old');
    expect(await revokeApiKey(h.db, alice.id, key.id, now())).toBe(true);
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toEqual({ ok: false, reason: 'revoked', userId: alice.id, apiKeyId: key.id, recognised: true, source: 'mcp' });
  });

  it('returns disabled for a key of a disabled user', async () => {
    const carol = await createUser(h.db, { email: 'carol@example.com', name: 'Carol', role: 'member', password: 'carol-password-1' });
    const { key, plaintext } = await newKey(carol.id, 'k');
    await h.db.update(users).set({ disabledAt: now() }).where(eq(users.id, carol.id));
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toEqual({ ok: false, reason: 'disabled', userId: carol.id, apiKeyId: key.id, recognised: true, source: 'mcp' });
  });

  it('reports disabled before revoked (disabling revokes every key)', async () => {
    const erin = await createUser(h.db, { email: 'erin@example.com', name: 'Erin', role: 'member', password: 'erin-password-12' });
    const { key, plaintext } = await newKey(erin.id, 'k');
    await revokeApiKey(h.db, erin.id, key.id, now());
    await h.db.update(users).set({ disabledAt: now() }).where(eq(users.id, erin.id));
    expect(await authenticateBearer(h.db, `Bearer ${plaintext}`, SECRET, now())).toMatchObject({ ok: false, reason: 'disabled', userId: erin.id, apiKeyId: key.id });
  });

  it('accepts a minted internal token as source chat with a null apiKeyId', async () => {
    const token = await mintInternalToken(bob.id, SECRET);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toEqual({ ok: true, user: bob, apiKeyId: null, source: 'chat' });
  });

  it('returns disabled for an internal token of a user disabled after minting', async () => {
    const dave = await createUser(h.db, { email: 'dave@example.com', name: 'Dave', role: 'member', password: 'dave-password-12' });
    const token = await mintInternalToken(dave.id, SECRET);
    await h.db.update(users).set({ disabledAt: now() }).where(eq(users.id, dave.id));
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toEqual({ ok: false, reason: 'disabled', userId: dave.id, apiKeyId: null, recognised: true, source: 'chat' });
  });

  it('returns unknown (recognisable, chat) for a valid internal token of a user that does not exist', async () => {
    const token = await mintInternalToken(randomUUID(), SECRET);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toEqual({ ok: false, reason: 'unknown', userId: null, apiKeyId: null, recognised: true, source: 'chat' });
  });

  it('returns unknown, not recognisable, for a token signed with another secret', async () => {
    const token = await mintInternalToken(bob.id, 'o'.repeat(32));
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', userId: null, apiKeyId: null, recognised: false });
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
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', recognised: false });
  });

  it('returns unknown for a hand-built alg none token', async () => {
    const t = Math.floor(Date.now() / 1000);
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: bob.id, aud: 'gateway-chat', iss: 'urumi-gateway', iat: t, exp: t + 300 })}.`;
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', userId: null, recognised: false });
  });

  it('returns expired, attributed to the user with source chat, for a validly signed token past exp', async () => {
    const token = await mintInternalToken(bob.id, SECRET, 300);
    const later = new Date(Date.now() + 306_000);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, later)).toEqual({ ok: false, reason: 'expired', userId: bob.id, apiKeyId: null, recognised: true, source: 'chat' });
  });

  it('allows the 5 s clock tolerance on exp', async () => {
    const token = await mintInternalToken(bob.id, SECRET, 300);
    const justAfter = new Date(Date.now() + 302_000);
    expect(await authenticateBearer(h.db, `Bearer ${token}`, SECRET, justAfter)).toMatchObject({ ok: true, source: 'chat' });
  });

  it('returns unknown, not recognisable, for a non-Bearer scheme or garbage', async () => {
    expect(await authenticateBearer(h.db, 'Basic abc', SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', recognised: false });
    expect(await authenticateBearer(h.db, 'Bearer not-a-jwt', SECRET, now())).toMatchObject({ ok: false, reason: 'unknown', recognised: false });
  });
});
