import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../src/logger.js';
import { startMcpHttpServer, type RunningMcpHttpServer } from '../src/mcpHttpServer.js';
import { defineTool, ok, registerTools, toolError } from '../src/tools.js';

describe('ok / toolError', () => {
  it('ok() gives summary + compact JSON as text and the same structuredContent', () => {
    const r = ok('Done.', { a: 1, b: ['x'] });
    expect(r.content).toEqual([{ type: 'text', text: 'Done.\n{"a":1,"b":["x"]}' }]);
    expect(r.structuredContent).toEqual({ a: 1, b: ['x'] });
    expect(r.isError).toBeUndefined();
  });
  it('toolError() sets isError', () => {
    expect(toolError('x')).toEqual({ content: [{ type: 'text', text: 'x' }], isError: true });
  });
});

describe('registerTools', () => {
  let running: RunningMcpHttpServer | undefined;
  afterEach(async () => {
    const r = running;
    running = undefined;
    if (r) await r.close();
  });

  it('registers each definition; invalid args come back as an isError result', async () => {
    const deps = { prefix: 'hi' };
    const echo = defineTool({
      name: 'echo',
      title: 'Echo',
      description: 'Echoes text.',
      inputSchema: z.object({ text: z.string() }),
      handler: async ({ text }, d: typeof deps) => ok(`${d.prefix} ${text}`, { text }),
    });
    const two = defineTool({
      name: 'two',
      title: 'Two',
      description: 'Second tool.',
      inputSchema: z.object({}),
      handler: async (_args, _d: typeof deps) => toolError('nope'),
    });
    running = await startMcpHttpServer({
      name: 't',
      version: '0',
      port: 0,
      host: '127.0.0.1',
      auth: { kind: 'bearer', token: 'tok' },
      logger: createLogger('t', 'silent'),
      allowedHosts: ['127.0.0.1'],
      registerTools: (s) => registerTools(s, [echo, two], deps),
    });
    const client = new Client({ name: 'c', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer tok' } },
      }),
      { timeout: 5000 },
    );
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['echo', 'two']);
    const good = await client.callTool({ name: 'echo', arguments: { text: 'there' } });
    expect(good.structuredContent).toEqual({ text: 'there' });
    const bad = await client.callTool({ name: 'echo', arguments: { text: 5 } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
