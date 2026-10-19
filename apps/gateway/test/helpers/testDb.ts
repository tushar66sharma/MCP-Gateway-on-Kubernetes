import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { DbHandle } from '../../src/db/client.js';
import { migrationsFolder } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';

/** A fresh in-memory PGlite database with all migrations applied. */
export async function createTestDb(): Promise<DbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const handle: DbHandle = {
    db,
    ping: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
  await handle.migrate();
  return handle;
}
