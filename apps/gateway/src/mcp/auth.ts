import type { RequestHandler } from 'express';
import { FixedWindowLimiter } from '../auth/rateLimit.js';
import { authenticateBearer, type BearerAuthResult } from '../auth/bearer.js';
import type { AuthUser } from '../auth/users.js';
import type { GatewayDeps } from '../server.js';

/** What the /mcp auth middleware puts on `res.locals.auth`; tool handlers read it via mcpRequestLocals. */
export interface McpAuth {
  user: AuthUser;
  apiKeyId: string | null;
  source: 'mcp' | 'chat';
}

type Rejection = Extract<BearerAuthResult, { ok: false }>;

/** Stored in audit_logs.error_message: the reason only, never the presented credential. */
const REASON_TEXT: Record<Rejection['reason'], string> = {
  missing: 'missing credential',
  unknown: 'unknown credential',
  revoked: 'API key revoked',
  disabled: 'user disabled',
  expired: 'internal token expired',
};

const TOO_MANY = { jsonrpc: '2.0', error: { code: -32029, message: 'Too many failed authentication attempts' }, id: null } as const;

const UNAUTHORIZED = { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null } as const;

/**
 * Per-request /mcp authentication (spec §6.5, §6.8): an API key or the internal chat token, checked
 * against the database every time (no cache, so a revoked key fails on its very next request).
 * A rejection is audited as auth_rejected only when the credential is recognisable (final-review
 * ruling M2): a well-formed `ugw_` key (unknown → null user; revoked or disabled → its owner) or an
 * internal token whose signature verified (expired → its user, source 'chat'). A missing header,
 * another scheme or a malformed value writes no row, only a debug log line, so anonymous garbage
 * cannot grow the audit table.
 * Recognised rejections are also limited per client IP (deps.mcpAuthLimiter): over the limit the client
 * gets 429 with Retry-After, no audit row, and one warn line per IP per window. A valid credential is
 * always accepted and never counts, and unrecognised garbage stays a plain 401 that does not count, so a
 * noisy client behind a shared IP cannot lock out a valid key.
 * It answers 401 itself (never next(err)), so the JSON-RPC body and WWW-Authenticate are exact.
 */
export function createMcpAuth(deps: GatewayDeps): RequestHandler {
  // At most one 'limited' warn line per IP per window (same window as the failure limiter).
  const warned = new FixedWindowLimiter({ max: 1, windowMs: 60_000, clock: deps.clock });
  return async (req, res, next) => {
    const now = deps.clock();
    const result = await authenticateBearer(deps.db.db, req.headers.authorization, deps.config.GATEWAY_INTERNAL_TOKEN_SECRET, now);
    if (result.ok) {
      const auth: McpAuth = { user: result.user, apiKeyId: result.apiKeyId, source: result.source };
      res.locals.auth = auth;
      next();
      return;
    }
    if (result.recognised) {
      const ip = req.ip ?? 'unknown';
      const limit = deps.mcpAuthLimiter.hit(ip);
      if (!limit.allowed) {
        if (warned.hit(ip).allowed) deps.logger.warn({ ip, retryAfterSec: limit.retryAfterSec }, 'mcp auth failures limited');
        res.setHeader('Retry-After', String(limit.retryAfterSec));
        res.status(429).json(TOO_MANY);
        return;
      }
      await deps.audit.record({
        event: 'auth_rejected',
        source: result.source,
        userId: result.userId,
        apiKeyId: result.apiKeyId,
        serverId: null,
        serverSlug: null,
        toolName: null,
        startedAt: now,
        durationMs: 0,
        outcome: 'unauthorized',
        errorMessage: REASON_TEXT[result.reason],
      });
      deps.logger.info({ reason: result.reason, userId: result.userId, source: result.source }, 'mcp auth rejected');
    } else {
      deps.logger.debug({ reason: result.reason }, 'mcp auth rejected (unrecognised credential, not audited)');
    }
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json(UNAUTHORIZED);
  };
}
