import { describe, expect, it } from 'vitest';
import { MIGRATION_LOCK_KEY, withMigrationLock } from '../../src/db/migrate.js';

function fakeClient() {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return { calls, query: async (sql: string, params?: unknown[]) => void calls.push({ sql, params }) };
}

describe('withMigrationLock', () => {
  it('runs migrations inside the advisory lock and unlocks on failure', async () => {
    const ok = fakeClient();
    const order: string[] = [];
    const result = await withMigrationLock(
      { query: async (s, p) => (order.push(s), ok.query(s, p)) },
      async () => {
        order.push('run');
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(order).toEqual(['select pg_advisory_lock($1)', 'run', 'select pg_advisory_unlock($1)']);
    // The key is sent as a string; Postgres infers bigint from the function signature.
    expect(ok.calls.map((c) => c.params)).toEqual([[MIGRATION_LOCK_KEY.toString()], [MIGRATION_LOCK_KEY.toString()]]);

    const bad = fakeClient();
    const boom = new Error('migration failed');
    await expect(
      withMigrationLock(bad, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(bad.calls.map((c) => c.sql)).toEqual(['select pg_advisory_lock($1)', 'select pg_advisory_unlock($1)']);
  });
});
