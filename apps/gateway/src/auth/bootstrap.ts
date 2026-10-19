import { sql } from 'drizzle-orm';
import type { Logger } from '@urumi/shared';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../security/passwords.js';
import { normalizeEmail } from './users.js';

/**
 * Creates the first admin (name 'Admin') from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD when the
 * users table is empty (spec §6.7). True only when this call inserted the admin; a concurrent replica
 * inserting the same email first makes this a no-op rather than an error. Never logs the credentials.
 */
export async function ensureBootstrapAdmin(db: Db, email: string, password: string, logger: Logger): Promise<boolean> {
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  if ((count?.n ?? 0) > 0) return false;
  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(users)
    .values({ email: normalizeEmail(email), name: 'Admin', role: 'admin', passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (inserted.length === 0) return false;
  logger.info('bootstrap admin created');
  return true;
}
