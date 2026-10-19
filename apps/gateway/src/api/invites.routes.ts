import express from 'express';
import { z } from 'zod';
import { acceptInvite, createInvite, deletePendingInvite, findUsableInvite, inviteLink, listPendingInvites, toInviteView } from '../auth/invites.js';
import { currentUser, requireRole, requireSession } from '../auth/middleware.js';
import { createSession, sessionCookie } from '../auth/sessions.js';
import { findUserByEmail } from '../auth/users.js';
import { hashPassword } from '../security/passwords.js';
import type { GatewayDeps } from '../server.js';
import { ApiError } from './errors.js';
import { parseBody, uuidParam } from './validate.js';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const role = z.enum(['admin', 'member']);
const createBody = z.object({ email, role }).strict();
const acceptBody = z.object({ name: z.string().trim().min(1).max(100), password: z.string().min(10).max(200) }).strict();

const inviteInvalid = () => new ApiError(404, 'INVITE_INVALID', 'This invite link is invalid or has expired');

export function createInvitesRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  const session = requireSession(deps);
  const adminOnly = requireRole('admin');

  router.get('/invites', session, adminOnly, async (_req, res) => {
    res.json(await listPendingInvites(deps.db.db, deps.clock()));
  });

  router.post('/invites', session, adminOnly, async (req, res) => {
    const body = parseBody(createBody, req.body);
    if (await findUserByEmail(deps.db.db, body.email)) throw new ApiError(409, 'CONFLICT', 'A user with this email already exists');
    const now = deps.clock();
    const { invite, token } = await createInvite(deps.db.db, { email: body.email, role: body.role, createdBy: currentUser(res).id }, now);
    // The only place the link (a bearer secret) ever appears; it is not logged.
    res.status(201).json({ invite: toInviteView(invite, now), link: inviteLink(deps.config.PUBLIC_APP_URL, token) });
  });

  router.delete('/invites/:id', session, adminOnly, async (req, res) => {
    if (!(await deletePendingInvite(deps.db.db, uuidParam(req.params.id)))) throw new ApiError(404, 'NOT_FOUND', 'Invite not found');
    res.status(204).end();
  });

  router.get('/invites/:token', async (req, res) => {
    const invite = await findUsableInvite(deps.db.db, req.params.token, deps.clock());
    if (!invite) throw inviteInvalid();
    res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt.toISOString() });
  });

  router.post('/invites/:token/accept', async (req, res) => {
    const body = parseBody(acceptBody, req.body);
    // Cheap lookup first, so a random token never costs an argon2 hash.
    if (!(await findUsableInvite(deps.db.db, req.params.token, deps.clock()))) throw inviteInvalid();
    const passwordHash = await hashPassword(body.password);
    const now = deps.clock();
    const result = await acceptInvite(deps.db.db, req.params.token, { name: body.name, passwordHash }, now);
    if (!result.ok) {
      if (result.reason === 'conflict') throw new ApiError(409, 'CONFLICT', 'A user with this email already exists');
      throw inviteInvalid();
    }
    const token = await createSession(deps.db.db, result.user.id, now);
    // Only if an admin disabled the brand-new user within this request; the account itself exists.
    if (token === null) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    res.append('Set-Cookie', sessionCookie(token, deps.config.COOKIE_SECURE));
    res.status(201).json({ user: result.user });
  });

  return router;
}
