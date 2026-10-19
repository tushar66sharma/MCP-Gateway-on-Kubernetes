import type { Logger } from '@urumi/shared';
import type { Db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  event: 'tool_call' | 'auth_rejected';
  source: 'mcp' | 'chat';
  userId: string | null;
  apiKeyId: string | null;
  serverId: string | null;
  serverSlug: string | null;
  toolName: string | null;
  startedAt: Date;
  durationMs: number;
  outcome: 'success' | 'error' | 'timeout' | 'denied' | 'unauthorized';
  errorMessage: string | null;
}

const MAX_ERROR_MESSAGE = 500;

/** Appends audit rows. Never throws: a failed insert is logged (without the entry) and the call goes on. */
export class AuditWriter {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async record(e: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        event: e.event,
        source: e.source,
        userId: e.userId,
        apiKeyId: e.apiKeyId,
        serverId: e.serverId,
        serverSlug: e.serverSlug,
        toolName: e.toolName,
        startedAt: e.startedAt,
        durationMs: Math.max(0, Math.round(e.durationMs)),
        outcome: e.outcome,
        errorMessage: e.errorMessage === null ? null : e.errorMessage.slice(0, MAX_ERROR_MESSAGE),
      });
    } catch (err) {
      // Only the class/code: driver messages can echo the values being inserted.
      const code = (err as { code?: unknown } | null)?.code;
      this.logger.error(
        { reason: typeof code === 'string' ? code : err instanceof Error ? err.name : 'UnknownError', event: e.event, outcome: e.outcome },
        'audit insert failed',
      );
    }
  }
}
