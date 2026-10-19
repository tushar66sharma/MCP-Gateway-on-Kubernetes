import { startMcpHttpServer, type Logger, type RunningMcpHttpServer } from '@urumi/shared';
import type { NotesConfig } from './config.js';
import { NotesStore } from './notesStore.js';
import { registerNotesTools } from './tools.js';

export interface StartOptions {
  config: NotesConfig;
  logger: Logger;
  version: string;
  store?: NotesStore;
  now?: () => Date;
  host?: string;
}

export function startNotesServer(o: StartOptions): Promise<RunningMcpHttpServer> {
  const { config } = o;
  const now = o.now ?? (() => new Date());
  const deps = { store: o.store ?? new NotesStore({ now }), now };
  return startMcpHttpServer({
    name: 'mcp-notes',
    version: o.version,
    port: config.PORT,
    host: o.host,
    auth: { kind: 'bearer', token: config.MCP_AUTH_TOKEN },
    logger: o.logger,
    allowedHosts: config.MCP_ALLOWED_HOSTS,
    registerTools: (s) => { registerNotesTools(s, deps); },
    readinessCheck: () => Promise.resolve(true),
  });
}
