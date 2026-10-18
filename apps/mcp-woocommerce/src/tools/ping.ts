import { z } from 'zod';
import { ok } from './format.js';
import { defineTool } from './types.js';

export const ping = defineTool({
  name: 'ping',
  title: 'Ping',
  description: 'Health check: returns ok and the server time.',
  inputSchema: z.object({}),
  handler: (_args, { now }) => {
    const time = now().toISOString();
    return Promise.resolve(ok(`ok at ${time}`, { ok: true, server: 'mcp-woocommerce', time }));
  },
});
