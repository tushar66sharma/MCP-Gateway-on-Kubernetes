import express from 'express';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '../auth/apiKeys.js';
import { currentUser, requireRole, requireSession } from '../auth/middleware.js';
import { getUser } from '../auth/users.js';
import type { GatewayDeps } from '../server.js';
import { ApiError } from './errors.js';
import { parseBody, uuidParam } from './validate.js';

const createBody = z.object({ name: z.string().trim().min(1).max(60) }).strict();

const keyNotFound = () => new ApiError(404, 'NOT_FOUND', 'Key not found');

/** Own keys (`/keys`, any session) and an admin managing another user's keys (`/users/:id/keys`). */
export function createKeysRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  const session = requireSession(deps);
  const adminOnly = requireRole('admin');

  /** The path user for the admin routes; 404 when there is no such user. */
  const targetUserRow = async (raw: unknown) => {
    const user = await getUser(deps.db.db, uuidParam(raw));
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    return user;
  };
  const targetUser = async (raw: unknown): Promise<string> => (await targetUserRow(raw)).id;
  const disabledConflict = () => new ApiError(409, 'CONFLICT', 'User is disabled');

  router.get('/keys', session, async (_req, res) => {
    res.json(await listApiKeys(deps.db.db, currentUser(res).id));
  });

  router.post('/keys', session, async (req, res) => {
    const { name } = parseBody(createBody, req.body);
    const me = currentUser(res).id;
    // The plaintext is in this response only; it is never stored or logged.
    const created = await createApiKey(deps.db.db, { userId: me, createdBy: me, name }, deps.clock());
    // Disabled after requireSession passed: the session is gone too.
    if (!created) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    res.status(201).json(created);
  });

  router.delete('/keys/:id', session, async (req, res) => {
    // Another user's key is indistinguishable from a missing one.
    if (!(await revokeApiKey(deps.db.db, currentUser(res).id, uuidParam(req.params.id), deps.clock()))) throw keyNotFound();
    res.status(204).end();
  });

  router.get('/users/:id/keys', session, adminOnly, async (req, res) => {
    res.json(await listApiKeys(deps.db.db, await targetUser(req.params.id)));
  });

  // Spec §6.2: an admin issues keys for a *member*. Another admin's key would let one admin act as
  // another in the audit trail (403); a disabled user cannot get a key (409). Own keys: POST /keys.
  router.post('/users/:id/keys', session, adminOnly, async (req, res) => {
    const target = await targetUserRow(req.params.id);
    const me = currentUser(res).id;
    if (target.role === 'admin' && target.id !== me) throw new ApiError(403, 'FORBIDDEN', 'Admins create their own keys');
    if (target.disabledAt !== null) throw disabledConflict();
    const { name } = parseBody(createBody, req.body);
    const created = await createApiKey(deps.db.db, { userId: target.id, createdBy: me, name }, deps.clock());
    // Disabled after the check above (re-checked under lock in the insert's transaction).
    if (!created) throw disabledConflict();
    res.status(201).json(created);
  });

  router.delete('/users/:id/keys/:keyId', session, adminOnly, async (req, res) => {
    const userId = await targetUser(req.params.id);
    if (!(await revokeApiKey(deps.db.db, userId, uuidParam(req.params.keyId), deps.clock()))) throw keyNotFound();
    res.status(204).end();
  });

  return router;
}
