import express from 'express';
import { z } from 'zod';
import { queryAudit } from '../audit/query.js';
import { currentUser, requireSession } from '../auth/middleware.js';
import type { GatewayDeps } from '../server.js';
import { SLUG_RE } from '../upstreams/naming.js';
import { ApiError } from './errors.js';
import { parseQuery } from './validate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

const auditQuery = z
  .object({
    userId: z
      .string()
      .regex(UUID)
      .transform((v) => v.toLowerCase())
      .optional(),
    serverSlug: z.string().regex(SLUG_RE).optional(),
    // A tool name as audited: the upstream name, or the name as requested when no server matched
    // (which can be anything a client sent, so only the length is bounded).
    toolName: z.string().min(1).max(200).optional(),
    outcome: z.enum(['success', 'error', 'timeout', 'denied', 'unauthorized']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    // bigserial ids stay far below 2^53, so a 15-digit cap keeps Number(cursor) exact.
    cursor: z.string().regex(/^[1-9][0-9]{0,14}$/).optional(),
  })
  .strict();

/** GET /audit: an admin sees every row; a member only their own (spec §6.2). */
export function createAuditRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();

  router.get('/audit', requireSession(deps), async (req, res) => {
    const q = parseQuery(auditQuery, req.query);
    const me = currentUser(res);
    if (me.role !== 'admin') {
      if (q.userId !== undefined && q.userId !== me.id) throw new ApiError(403, 'FORBIDDEN', 'You can only see your own audit entries');
      q.userId = me.id;
    }
    res.json(await queryAudit(deps.db.db, q));
  });

  return router;
}
