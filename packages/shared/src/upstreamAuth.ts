import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export type UpstreamAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'header'; header: string; value: string };

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function upstreamAuthMiddleware(auth: UpstreamAuth): RequestHandler {
  return (req, res, next) => {
    if (auth.kind === 'none') {
      next();
      return;
    }

    let supplied: string | undefined;
    if (auth.kind === 'bearer') {
      const match = /^bearer\s+(.+)$/i.exec(singleHeader(req.headers.authorization)?.trim() ?? '');
      supplied = match?.[1];
    } else {
      supplied = singleHeader(req.headers[auth.header.toLowerCase()]);
    }
    const expected = auth.kind === 'bearer' ? auth.token : auth.value;

    if (supplied !== undefined && safeEqual(supplied, expected)) {
      next();
      return;
    }

    if (auth.kind === 'bearer') res.set('WWW-Authenticate', 'Bearer');
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  };
}
