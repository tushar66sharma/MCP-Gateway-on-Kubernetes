import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  createLogger,
  defineTool,
  mcpRequestLocals,
  ok,
  registerTools,
  startMcpHttpServer,
  toolError,
  upstreamAuthMiddleware,
  type UpstreamAuth,
} from '@urumi/shared';
import type { RequestHandler } from 'express';
import { z } from 'zod';

export interface FakeUpstream {
  url: string;
  port: number;
  /** One entry per tools/call that passed auth; `headers` holds every request header (lowercase names). */
  calls: { tool: string; headers: Record<string, string | undefined> }[];
  /** Every HTTP request that reached /mcp, before auth (so a blocked connect shows 0). */
  requests: number;
  stop(): Promise<void>;
}

const silent = createLogger('fake-upstream', 'silent');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function header(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function startFakeUpstream(o: {
  name: string;
  tools: string[];
  auth: UpstreamAuth;
  port?: number;
  slowMs?: number;
  isErrorTool?: string;
  /** Advertise the tools without any description. */
  noDescription?: boolean;
}): Promise<FakeUpstream> {
  const checkAuth = upstreamAuthMiddleware(o.auth);
  const fake: FakeUpstream = { url: '', port: 0, calls: [], requests: 0, stop: async () => {} };

  // Runs in front of the real auth middleware: counts the request and keeps every request header in
  // res.locals, which tool handlers read back through mcpRequestLocals.
  const auth: RequestHandler = (req, res, next) => {
    fake.requests += 1;
    const all: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(req.headers)) all[name] = header(value);
    res.locals.fakeHeaders = all;
    checkAuth(req, res, next);
  };

  const tools = o.tools.map((tool) =>
    defineTool<null, z.ZodObject>({
      name: tool,
      title: tool,
      description: `${o.name} ${tool}`,
      inputSchema: z.object({}).passthrough(),
      handler: async () => {
        const locals = mcpRequestLocals.getStore() ?? {};
        fake.calls.push({ tool, headers: { ...(locals.fakeHeaders as Record<string, string | undefined>) } });
        if (o.slowMs) await sleep(o.slowMs);
        if (tool === o.isErrorTool) return toolError('boom');
        return ok(`${o.name}:${tool}`, { server: o.name, tool });
      },
    }),
  );

  const running = await startMcpHttpServer({
    name: `fake-${o.name}`,
    version: '0.0.0',
    port: o.port ?? 0,
    host: '127.0.0.1',
    auth,
    logger: silent,
    allowedHosts: ['127.0.0.1', 'localhost', 'rebind.test'],
    registerTools: (s) => {
      if (!o.noDescription) {
        registerTools(s, tools, null);
        return;
      }
      for (const t of tools) {
        s.registerTool(t.name, { inputSchema: t.inputSchema }, async (args) => (await t.handler(args, null)) as CallToolResult);
      }
    },
  });
  fake.port = running.port;
  fake.url = `http://127.0.0.1:${running.port}/mcp`;
  fake.stop = async () => {
    await running.close();
  };
  return fake;
}

/** Plain HTTP server answering every request with `302 Location: <location>`. */
export async function startRedirectServer(location: string): Promise<{ url: string; requests: number; stop(): Promise<void> }> {
  const out = { url: '', requests: 0, stop: async () => {} };
  const server: Server = createServer((_req, res) => {
    out.requests += 1;
    res.writeHead(302, { Location: location });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  out.url = `http://127.0.0.1:${port}/mcp`;
  out.stop = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
  return out;
}

/** A port that was free a moment ago and has nothing listening on it. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
