import express from 'express';
import { z } from 'zod';
import { currentUser, requireRole, requireSession } from '../auth/middleware.js';
import { listUsers, toUserView, updateUser } from '../auth/users.js';
import type { GatewayDeps } from '../server.js';
import { ApiError } from './errors.js';
import { parseBody, uuidParam } from './validate.js';

const patchBody = z.object({ role: z.enum(['admin', 'member']).optional(), disabled: z.boolean().optional() }).strict();

export function createUsersRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  const session = requireSession(deps);
  const adminOnly = requireRole('admin');

  router.get('/users', session, adminOnly, async (_req, res) => {
    res.json((await listUsers(deps.db.db)).map(toUserView));
  });

  router.patch('/users/:id', session, adminOnly, async (req, res) => {
    const id = uuidParam(req.params.id);
    const body = parseBody(patchBody, req.body);
    const me = currentUser(res);
    // Also guarantees at least one active admin always remains: the one making the change.
    if (id === me.id && ((body.role !== undefined && body.role !== me.role) || body.disabled === true)) {
      throw new ApiError(409, 'CONFLICT', 'You cannot change your own role or disable yourself');
    }
    const user = await updateUser(deps.db.db, id, body, deps.clock());
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    res.json({ user: toUserView(user) });
  });

  return router;
}
