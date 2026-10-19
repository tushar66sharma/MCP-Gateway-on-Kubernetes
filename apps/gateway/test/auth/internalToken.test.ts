import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { mintInternalToken, verifyInternalToken } from '../../src/auth/internalToken.js';

const SECRET = 's'.repeat(32);
const USER = '6f1c2b8e-1d2a-4f5b-9c3d-2e4f6a8b0c1d';

describe('internal token', () => {
  it('mints an HS256 JWT with sub, aud, iss, iat and a 300 s exp', async () => {
    const token = await mintInternalToken(USER, SECRET);
    expect(decodeProtectedHeader(token).alg).toBe('HS256');
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ sub: USER, aud: 'gateway-chat', iss: 'urumi-gateway' });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(300);
  });

  it('verifies a fresh token and rejects a tampered or expired one', async () => {
    const token = await mintInternalToken(USER, SECRET);
    expect(await verifyInternalToken(token, SECRET, new Date())).toEqual({ userId: USER });
    expect(await verifyInternalToken(`${token.slice(0, -2)}AA`, SECRET, new Date())).toEqual({ error: 'invalid' });
    expect(await verifyInternalToken(token, SECRET, new Date(Date.now() + 310_000))).toEqual({ error: 'expired' });
  });

  it('rejects a token whose sub is not a user id', async () => {
    const token = await mintInternalToken('not-a-uuid', SECRET);
    expect(await verifyInternalToken(token, SECRET, new Date())).toEqual({ error: 'invalid' });
  });
});
