import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import type { Logger } from '@urumi/shared';
import { migrationsFolder } from './migrate.js';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  ping(): Promise<boolean>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** Pool configured by pg from PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD. */
export function createPostgresHandle(logger?: Logger): DbHandle {
  const pool = new pg.Pool({ max: 10 });
  // An idle client erroring (e.g. Postgres restarting) must not crash the process.
  // Only a code or class name is logged: the message can embed connection details.
  pool.on('error', (err) => logger?.warn({ reason: safeReason(err) }, 'postgres pool error'));
  const db = drizzle(pool, { schema });
  return {
    db,
    ping: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    migrate: () => migratePg(db, { migrationsFolder: migrationsFolder() }),
    close: () => pool.end(),
  };
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Error text from pg can embed connection details, so only a code or the class name is ever logged. */
function safeReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  return err instanceof Error ? err.name : 'UnknownError';
}

/** open + ping + migrate per attempt; throws after the last failed attempt. */
export async function connectWithRetry(
  open: () => Promise<DbHandle>,
  o: { attempts: number; delayMs: number; logger: Logger; sleep?: (ms: number) => Promise<void> },
): Promise<DbHandle> {
  const sleep = o.sleep ?? realSleep;
  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    let handle: DbHandle | undefined;
    try {
      handle = await open();
      if (!(await handle.ping())) throw new Error('ping failed');
      await handle.migrate();
      return handle;
    } catch (err) {
      o.logger.warn({ attempt, attempts: o.attempts, reason: safeReason(err) }, 'database not ready');
      await handle?.close().catch(() => {});
      if (attempt < o.attempts) await sleep(o.delayMs);
    }
  }
  throw new Error(`database not ready after ${o.attempts} attempts`);
}
