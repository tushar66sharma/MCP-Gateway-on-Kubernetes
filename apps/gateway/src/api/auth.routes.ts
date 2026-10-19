import express from 'express';
import { z } from 'zod';
import { currentUser, requireSession } from '../auth/middleware.js';
import { clearSessionCookie, createSession, deleteSession, sessionCookie, sessionTokenFrom } from '../auth/sessions.js';
import { findUserByEmail, normalizeEmail, toAuthUser } from '../auth/users.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import type { GatewayDeps } from '../server.js';
import { ApiError } from './errors.js';
import { parseBody } from './validate.js';

// Loose on purpose: a malformed email or out-of-policy password is just a failed login, not a 400 that
// reveals the policy. The caps only bound the work done per request.
const loginBody = z.object({ email: z.string().max(320), password: z.string().max(1024) });

let dummyHash: Promise<string> | undefined;
/** Verified against when the email is unknown, so both paths cost one argon2 verify. */
function timingDummy(): Promise<string> {
  dummyHash ??= hashPassword('timing-equaliser-not-a-real-password');
  return dummyHash;
}

const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export function createAuthRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  const session = requireSession(deps);

  router.post('/auth/login', async (req, res) => {
    const body = parseBody(loginBody, req.body);
    const email = normalizeEmail(body.email);
    // Before any password work, keyed on IP + normalised email; every attempt counts.
    const limit = deps.rateLimiter.hit(`${req.ip ?? 'unknown'}|${email}`);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many login attempts; try again later', { retryAfterSec: limit.retryAfterSec });
    }
    const user = await findUserByEmail(deps.db.db, email);
    const passwordOk = await verifyPassword(user?.passwordHash ?? (await timingDummy()), body.password);
    // One answer for unknown email, wrong password and disabled user.
    if (!user || !passwordOk || user.disabledAt !== null) throw invalidCredentials();
    const token = await createSession(deps.db.db, user.id, deps.clock());
    res.append('Set-Cookie', sessionCookie(token, deps.config.COOKIE_SECURE));
    res.json({ user: toAuthUser(user) });
  });

  router.post('/auth/logout', session, async (req, res) => {
    const token = sessionTokenFrom(req.headers.cookie);
    if (token !== null) await deleteSession(deps.db.db, token);
    res.append('Set-Cookie', clearSessionCookie(deps.config.COOKIE_SECURE));
    res.status(204).end();
  });

  router.get('/auth/me', session, (_req, res) => {
    res.json({ user: currentUser(res) });
  });

  return router;
}
