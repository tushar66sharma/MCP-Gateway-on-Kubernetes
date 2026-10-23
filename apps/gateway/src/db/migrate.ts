import { fileURLToPath } from 'node:url';

/** Works from both src/db and dist/db: the drizzle folder sits two levels up. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../../drizzle', import.meta.url));
}

/**
 * Session-level Postgres advisory lock key for migrations: a fixed arbitrary bigint, so two gateway
 * replicas (or an overlapping rollout) never migrate at the same time. Not used by anything else.
 */
export const MIGRATION_LOCK_KEY = 7314420001n;

/**
 * Runs `run` while holding the migration advisory lock on `client` (one connection: the lock belongs
 * to the session). The unlock is always attempted, even when `run` throws. The key is sent as a string
 * because bigint parameter serialisation is not guaranteed in node-postgres; Postgres infers bigint
 * from the function signature.
 *
 * An unlock failure (typically a dead connection) never replaces `run`'s outcome: it goes to
 * `onUnlockError` and is otherwise ignored, because Postgres releases a session lock when the session
 * ends, and the caller closes this connection right after.
 */
export async function withMigrationLock<T>(
  client: { query(sql: string, params?: unknown[]): Promise<unknown> },
  run: () => Promise<T>,
  onUnlockError?: (err: unknown) => void,
): Promise<T> {
  const key = MIGRATION_LOCK_KEY.toString();
  await client.query('select pg_advisory_lock($1)', [key]);
  try {
    return await run();
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1)', [key]);
    } catch (err) {
      onUnlockError?.(err);
    }
  }
}
