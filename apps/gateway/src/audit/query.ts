import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLogs, users } from '../db/schema.js';
import type { AuditEntry } from './writer.js';

export interface AuditQuery {
  userId?: string;
  serverSlug?: string;
  toolName?: string;
  outcome?: AuditEntry['outcome'];
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
  limit: number;
  /** The `nextCursor` of the previous page: the last id it returned. */
  cursor?: string;
}

export interface AuditView {
  id: string;
  event: string;
  source: string;
  userId: string | null;
  userEmail: string | null;
  serverSlug: string | null;
  toolName: string | null;
  startedAt: string;
  durationMs: number;
  outcome: string;
  errorMessage: string | null;
}

/**
 * Newest first by id (keyset pagination: stable while rows are appended). One extra row is read to
 * tell whether another page exists; `nextCursor` is then the last returned id, as a string.
 */
export async function queryAudit(db: Db, q: AuditQuery): Promise<{ items: AuditView[]; nextCursor: string | null }> {
  const where: SQL[] = [];
  if (q.userId !== undefined) where.push(eq(auditLogs.userId, q.userId));
  if (q.serverSlug !== undefined) where.push(eq(auditLogs.serverSlug, q.serverSlug));
  if (q.toolName !== undefined) where.push(eq(auditLogs.toolName, q.toolName));
  if (q.outcome !== undefined) where.push(eq(auditLogs.outcome, q.outcome));
  if (q.from !== undefined) where.push(gte(auditLogs.startedAt, q.from));
  if (q.to !== undefined) where.push(lt(auditLogs.startedAt, q.to));
  if (q.cursor !== undefined) where.push(lt(auditLogs.id, Number(q.cursor)));

  const rows = await db
    .select({
      id: auditLogs.id,
      event: auditLogs.event,
      source: auditLogs.source,
      userId: auditLogs.userId,
      userEmail: users.email,
      serverSlug: auditLogs.serverSlug,
      toolName: auditLogs.toolName,
      startedAt: auditLogs.startedAt,
      durationMs: auditLogs.durationMs,
      outcome: auditLogs.outcome,
      errorMessage: auditLogs.errorMessage,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(...where))
    .orderBy(desc(auditLogs.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const items = page.map(
    (r): AuditView => ({
      id: String(r.id),
      event: r.event,
      source: r.source,
      userId: r.userId,
      userEmail: r.userEmail,
      serverSlug: r.serverSlug,
      toolName: r.toolName,
      startedAt: r.startedAt.toISOString(),
      durationMs: r.durationMs ?? 0,
      outcome: r.outcome,
      errorMessage: r.errorMessage,
    }),
  );
  const last = items.at(-1);
  return { items, nextCursor: rows.length > q.limit && last ? last.id : null };
}
