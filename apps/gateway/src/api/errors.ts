import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '@urumi/shared';

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'SSRF_REJECTED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'CSRF_REJECTED'
  | 'NOT_FOUND'
  | 'INVITE_INVALID'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  // Chat (Phase 4): 503, 429 (with Retry-After), 502, 502, 502.
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_RATE_LIMITED'
  | 'LLM_AUTH_FAILED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_BAD_RESPONSE';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requestIdOf(locals: Record<string, unknown>): string | undefined {
  return typeof locals.requestId === 'string' ? locals.requestId : undefined;
}

export function apiErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const requestId = requestIdOf(res.locals as Record<string, unknown>);
    let status = 500;
    let code: ApiErrorCode = 'INTERNAL';
    let message = 'Internal error';
    let details: Record<string, unknown> | undefined;

    if (err instanceof ApiError) {
      ({ status, code, message } = err);
      details = err.details;
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Validation failed';
      details = { issues: err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) };
    } else {
      const s = (err as { status?: unknown } | null)?.status;
      if (typeof s === 'number' && s >= 400 && s < 500) {
        // body-parser errors (malformed JSON, too large): client mistakes, not internal failures.
        status = s;
        code = s === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED';
        message = s === 413 ? 'Request body too large' : 'Invalid request';
      } else {
        logger.error({ requestId, err: err instanceof Error ? err.name : 'unknown' }, 'unhandled api error');
      }
    }

    res.status(status).json({ error: { code, message, ...(details ? { details } : {}), ...(requestId ? { requestId } : {}) } });
  };
}
