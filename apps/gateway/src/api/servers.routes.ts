import { randomUUID } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { requireRole, requireSession } from '../auth/middleware.js';
import { isUniqueViolation } from '../auth/users.js';
import { ssrfOptionsOf } from '../config.js';
import { encryptSecret } from '../security/crypto.js';
import { assertSafeUpstreamUrl, SsrfError } from '../security/ssrf.js';
import type { GatewayDeps } from '../server.js';
import type { UpstreamState } from '../upstreams/manager.js';
import { SLUG_RE } from '../upstreams/naming.js';
import type { UpstreamPatch, UpstreamRow } from '../upstreams/repository.js';
import { ApiError } from './errors.js';
import { parseBody, uuidParam } from './validate.js';

/** Never the credential: only whether one is stored (spec §6.6). */
export interface ServerView {
  id: string;
  slug: string;
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'header';
  authHeaderName: string | null;
  hasCredential: boolean;
  enabled: boolean;
  status: UpstreamState['status'];
  lastError: string | null;
  checkedAt: string | null;
  toolCount: number;
  tools: { name: string; description: string }[];
  skippedTools: string[];
}

/** Headers the HTTP client owns or that would carry another credential: never a custom auth header. */
const RESERVED_HEADERS = new Set(['host', 'content-length', 'content-type', 'authorization', 'cookie', 'connection', 'transfer-encoding']);

const headerName = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}$/, 'must be 1-64 letters, digits or hyphens')
  .refine((n) => !RESERVED_HEADERS.has(n.toLowerCase()), 'is a reserved header name');
// Printable ASCII only, so the value is always a valid HTTP header value. Issue messages never echo it.
const credentialValue = z.string().max(4096).regex(/^[\x20-\x7e]*$/, 'must be printable ASCII');
const authType = z.enum(['none', 'bearer', 'header']);

const createBody = z
  .object({
    slug: z.string().regex(SLUG_RE, 'must match ^[a-z][a-z0-9-]{1,15}$'),
    name: z.string().trim().min(1).max(100),
    url: z.string().min(1).max(2048),
    authType,
    authHeaderName: headerName.optional(),
    credential: credentialValue.min(1).optional(),
  })
  .strict();

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    url: z.string().min(1).max(2048).optional(),
    enabled: z.boolean().optional(),
    authType: authType.optional(),
    authHeaderName: headerName.optional(),
    credential: credentialValue.optional(),
    clearCredential: z.boolean().optional(),
  })
  .strict();

function invalid(path: string, message: string): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', { issues: [{ path, message }] });
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Server not found');

const ORIGIN_CHANGE_MESSAGE = 'changing the server URL origin requires re-entering the credential (or clearCredential: true)';
const originChangeNeedsCredential = () => new ApiError(400, 'VALIDATION_FAILED', ORIGIN_CHANGE_MESSAGE, { issues: [{ path: 'credential', message: ORIGIN_CHANGE_MESSAGE }] });

/** The stored URL's origin; null for a URL that no longer parses (then any new URL counts as a change). */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The auth fields after a create or patch, checked as a whole: header auth needs a header name, a
 * header name only goes with header auth, and `none` carries no credential.
 */
function checkAuth(o: { authType: UpstreamRow['authType']; authHeaderName: string | null | undefined; credentialGiven: boolean }): void {
  if (o.authType === 'header' && !o.authHeaderName) throw invalid('authHeaderName', 'is required for header auth');
  if (o.authType !== 'header' && o.authHeaderName) throw invalid('authHeaderName', 'is only allowed for header auth');
  if (o.authType === 'none' && o.credentialGiven) throw invalid('credential', "is not allowed for authType 'none'");
}

/** Server registry (spec §6.2, §6.6): reads for any session, changes for admins only. */
export function createServersRouter(deps: GatewayDeps): express.Router {
  const router = express.Router();
  const session = requireSession(deps);
  const adminOnly = requireRole('admin');
  const encKey = deps.config.GATEWAY_ENCRYPTION_KEY;

  const view = (row: UpstreamRow): ServerView => {
    const state = deps.upstreams.getState(row.id);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      url: row.url,
      authType: row.authType,
      authHeaderName: row.authHeaderName,
      hasCredential: row.credentialEnc !== null,
      enabled: row.enabled,
      status: state.status,
      lastError: state.lastError,
      checkedAt: state.checkedAt?.toISOString() ?? null,
      toolCount: state.tools.length,
      tools: state.tools.map((t) => ({ name: t.name, description: t.description ?? '' })),
      skippedTools: state.skippedTools,
    };
  };

  const load = async (raw: unknown): Promise<UpstreamRow> => {
    const row = await deps.repo.get(uuidParam(raw));
    if (!row) throw notFound();
    return row;
  };

  const assertSafeUrl = async (url: string): Promise<void> => {
    try {
      await assertSafeUpstreamUrl(url, ssrfOptionsOf(deps.config));
    } catch (err) {
      if (err instanceof SsrfError) throw new ApiError(400, 'SSRF_REJECTED', `Upstream URL rejected: ${err.message}`, { reason: err.reason });
      throw err;
    }
  };

  router.get('/servers', session, async (_req, res) => {
    res.json((await deps.repo.list()).map(view));
  });

  router.get('/servers/:id', session, async (req, res) => {
    res.json(view(await load(req.params.id)));
  });

  router.post('/servers', session, adminOnly, async (req, res) => {
    const body = parseBody(createBody, req.body);
    checkAuth({ authType: body.authType, authHeaderName: body.authHeaderName, credentialGiven: body.credential !== undefined });
    await assertSafeUrl(body.url);
    if (await deps.repo.getBySlug(body.slug)) throw new ApiError(409, 'CONFLICT', 'A server with this slug already exists');
    // The id is the AES-GCM associated data (ADR-009), so it is generated before the insert.
    const id = randomUUID();
    let row: UpstreamRow;
    try {
      row = await deps.repo.insert({
        id,
        slug: body.slug,
        name: body.name,
        url: body.url,
        authType: body.authType,
        authHeaderName: body.authType === 'header' ? (body.authHeaderName ?? null) : null,
        credentialEnc: body.credential !== undefined ? encryptSecret(body.credential, encKey, id) : null,
        enabled: true,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, 'CONFLICT', 'A server with this slug already exists');
      throw err;
    }
    await deps.upstreams.upsert(row);
    res.status(201).json(view(row));
  });

  router.patch('/servers/:id', session, adminOnly, async (req, res) => {
    if (typeof req.body === 'object' && req.body !== null && Object.hasOwn(req.body, 'slug')) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'slug cannot be changed');
    }
    const body = parseBody(patchBody, req.body);
    const row = await load(req.params.id);

    if (body.clearCredential === true && body.credential !== undefined && body.credential !== '') {
      throw invalid('credential', 'must be empty or omitted with clearCredential');
    }
    if (body.clearCredential !== true && body.credential === '') throw invalid('credential', 'must not be empty; use clearCredential to remove it');
    const newCredential = body.clearCredential === true ? undefined : body.credential;

    const nextAuthType = body.authType ?? row.authType;
    // Switching away from header auth drops the stored header name; a header name sent with it is an error.
    const nextHeaderName = nextAuthType === 'header' ? (body.authHeaderName ?? row.authHeaderName) : null;
    checkAuth({ authType: nextAuthType, authHeaderName: body.authHeaderName ?? nextHeaderName, credentialGiven: newCredential !== undefined });
    if (body.url !== undefined && body.url !== row.url) {
      await assertSafeUrl(body.url);
      // A stored credential is never sent to a new origin (scheme, host or port) it was not entered
      // for: re-enter it, or clear it, in the same request. A path-only change keeps it. Nothing to
      // protect when no credential is stored or the server switches to authType 'none'.
      const keepsStored = row.credentialEnc !== null && nextAuthType !== 'none' && newCredential === undefined && body.clearCredential !== true;
      if (keepsStored && new URL(body.url).origin !== originOf(row.url)) throw originChangeNeedsCredential();
    }

    const patch: UpstreamPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.url !== undefined) patch.url = body.url;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.authType !== undefined) patch.authType = body.authType;
    if (nextHeaderName !== row.authHeaderName) patch.authHeaderName = nextHeaderName;
    // Omitted → kept; clearCredential → removed; authType 'none' never keeps one.
    if (body.clearCredential === true || (nextAuthType === 'none' && row.credentialEnc !== null)) patch.credentialEnc = null;
    else if (newCredential !== undefined) patch.credentialEnc = encryptSecret(newCredential, encKey, row.id);

    const updated = await deps.repo.update(row.id, patch);
    if (!updated) throw notFound();
    await deps.upstreams.upsert(updated);
    // A DELETE that ran between the update and the upsert removed the row, and the upsert just put
    // the server back into the manager: take it out again so a deleted server is never served.
    const current = await deps.repo.get(row.id);
    if (!current) {
      await deps.upstreams.remove(row.id);
      throw notFound();
    }
    res.json(view(current));
  });

  router.delete('/servers/:id', session, adminOnly, async (req, res) => {
    const row = await load(req.params.id);
    await deps.upstreams.remove(row.id);
    // audit_logs.server_id is ON DELETE SET NULL; server_slug keeps the history readable.
    if (!(await deps.repo.delete(row.id))) throw notFound();
    res.status(204).end();
  });

  router.post('/servers/:id/refresh', session, adminOnly, async (req, res) => {
    const row = await load(req.params.id);
    await deps.upstreams.refresh(row.id);
    res.json(view((await deps.repo.get(row.id)) ?? row));
  });

  return router;
}
