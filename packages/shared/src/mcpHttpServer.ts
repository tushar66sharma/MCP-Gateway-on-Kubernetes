import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostHeaderValidation } from '@modelcontextprotocol/express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import express from 'express';
import type { Logger } from './logger.js';
import { upstreamAuthMiddleware, type UpstreamAuth } from './upstreamAuth.js';

export type SdkMcpServer = McpServer;

export interface McpHttpServerOptions {
  name: string;
  version: string;
  port: number;
  host?: string;
  auth: UpstreamAuth;
  logger: Logger;
  /** Host-header (DNS-rebinding) check, applied to /mcp ONLY. Ports in entries are ignored. */
  allowedHosts: string[];
  registerTools: (server: SdkMcpServer) => void;
  readinessCheck?: () => Promise<boolean>;
}

export interface RunningMcpHttpServer {
  port: number;
  close(): Promise<void>;
}

/**
 * The SDK compares `new URL(...).hostname`, which is always lowercase and has no port: so lowercase,
 * strip any ":port" and drop empty entries. Throws when nothing is left (fail fast at startup).
 */
export function normalizeHosts(hosts: string[]): string[] {
  const out: string[] = [];
  for (const raw of hosts) {
    const h = raw.trim().toLowerCase();
    if (h.length === 0) continue;
    const bracket = /^(\[[^\]]+\])(?::\d+)?$/.exec(h);
    const name = bracket?.[1] ?? (h.split(':').length === 2 ? (h.split(':')[0] ?? h) : h);
    if (name.length > 0 && !out.includes(name)) out.push(name);
  }
  if (out.length === 0) {
    throw new Error('allowedHosts is empty: list at least one host name for the /mcp Host check');
  }
  return out;
}

export async function startMcpHttpServer(opts: McpHttpServerOptions): Promise<RunningMcpHttpServer> {
  const { logger } = opts;
  const readiness = opts.readinessCheck ?? (async () => true);
  // Validate configuration before building anything (both throw with value-free messages).
  const allowedHosts = normalizeHosts(opts.allowedHosts);
  const auth = upstreamAuthMiddleware(opts.auth);

  const mcpHandler = createMcpHandler(
    () => {
      const server = new McpServer({ name: opts.name, version: opts.version });
      opts.registerTools(server);
      return server;
    },
    { onerror: (err) => logger.error({ err: err.message }, 'mcp error') },
  );
  const nodeHandler = toNodeHandler(mcpHandler);

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info({ method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) }, 'request');
    });
    next();
  });

  // Probes are never host-checked: the kubelet sends `Host: <pod IP>:<port>`.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readyz', (_req, res) => {
    readiness().then(
      (ready) => {
        res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not ready' });
      },
      () => {
        res.status(503).json({ status: 'not ready' });
      },
    );
  });

  app.post(
    '/mcp',
    hostHeaderValidation(allowedHosts),
    auth,
    express.json({ limit: '1mb' }),
    (req, res) => {
      nodeHandler(req, res, req.body).catch((err: unknown) => {
        logger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'mcp handler failed');
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
        }
      });
    },
  );
  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  // JSON body parse errors and other middleware errors: JSON-RPC shaped, no details.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = (err as { status?: number } | null)?.status;
    const bad = typeof status === 'number' && status >= 400 && status < 500;
    res
      .status(bad ? status : 500)
      .json({ jsonrpc: '2.0', error: { code: bad ? -32700 : -32603, message: bad ? 'Invalid request body' : 'Internal error' }, id: null });
  });

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(opts.port, opts.host ?? '0.0.0.0', () => resolve(s));
    s.once('error', reject);
  });
  const port = (httpServer.address() as AddressInfo).port;
  logger.info({ port }, `${opts.name} listening`);

  return {
    port,
    close: async () => {
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
        httpServer.closeAllConnections();
      });
    },
  };
}
