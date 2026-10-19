import { fileURLToPath } from 'node:url';

/** Works from both src/db and dist/db: the drizzle folder sits two levels up. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('../../drizzle', import.meta.url));
}
