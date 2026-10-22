import { randomUUID } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';

export const INTERNAL_TOKEN_AUDIENCE = 'gateway-chat';
export const INTERNAL_TOKEN_ISSUER = 'urumi-gateway';
export const INTERNAL_TOKEN_TTL_SEC = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * The chat agent's short-lived credential for the loopback /mcp call (ADR-010): HS256 JWT with
 * sub = user id, aud 'gateway-chat', iss 'urumi-gateway', a random jti (so two tokens minted in the same
 * second still differ), iat and exp = iat + ttlSec.
 */
export function mintInternalToken(userId: string, secret: string, ttlSec = INTERNAL_TOKEN_TTL_SEC, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setAudience(INTERNAL_TOKEN_AUDIENCE)
    .setIssuer(INTERNAL_TOKEN_ISSUER)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSec)
    .sign(keyOf(secret));
}

const userIdOf = (sub: unknown): string | null => (typeof sub === 'string' && UUID.test(sub) ? sub.toLowerCase() : null);

/**
 * HS256 only (so `alg: none` and every other algorithm are rejected), audience and issuer checked,
 * 5 s clock tolerance. The signature is verified before any claim, so 'expired' is never reported
 * for a forged token. No reason or claim from an invalid token is returned. An expired token carries
 * its user id: jose checks the signature before `exp`, so JWTExpired.payload is our own (the audit row
 * of a chat turn that outlived its token is attributed to the user).
 */
export async function verifyInternalToken(
  token: string,
  secret: string,
  now: Date,
): Promise<{ userId: string } | { error: 'expired'; userId: string | null } | { error: 'invalid' }> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: ['HS256'],
      audience: INTERNAL_TOKEN_AUDIENCE,
      issuer: INTERNAL_TOKEN_ISSUER,
      clockTolerance: 5,
      currentDate: now,
      requiredClaims: ['sub', 'iat', 'exp'],
    });
    const userId = userIdOf(payload.sub);
    return userId === null ? { error: 'invalid' } : { userId };
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { error: 'expired', userId: userIdOf(err.payload.sub) };
    return { error: 'invalid' };
  }
}
