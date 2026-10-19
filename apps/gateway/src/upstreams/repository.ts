import { eq } from 'drizzle-orm';
import type { UpstreamAuth } from '@urumi/shared';
import type { Db } from '../db/client.js';
import { upstreamServers } from '../db/schema.js';
import { decryptSecret } from '../security/crypto.js';
import type { UpstreamRecord, UpstreamStatus } from './connection.js';

export interface UpstreamRow {
  id: string;
  slug: string;
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'header';
  authHeaderName: string | null;
  credentialEnc: Buffer | null;
  enabled: boolean;
  lastStatus: UpstreamStatus;
  lastError: string | null;
  lastCheckedAt: Date | null;
  toolCount: number;
  createdAt: Date;
}

export type UpstreamInsert = Omit<UpstreamRow, 'lastStatus' | 'lastError' | 'lastCheckedAt' | 'toolCount' | 'createdAt'>;
export type UpstreamPatch = Partial<Pick<UpstreamRow, 'name' | 'url' | 'authType' | 'authHeaderName' | 'credentialEnc' | 'enabled'>>;

export class UpstreamRepository {
  constructor(private readonly db: Db) {}

  list(): Promise<UpstreamRow[]> {
    return this.db.select().from(upstreamServers).orderBy(upstreamServers.slug);
  }

  async get(id: string): Promise<UpstreamRow | null> {
    const [row] = await this.db.select().from(upstreamServers).where(eq(upstreamServers.id, id));
    return row ?? null;
  }

  async getBySlug(slug: string): Promise<UpstreamRow | null> {
    const [row] = await this.db.select().from(upstreamServers).where(eq(upstreamServers.slug, slug));
    return row ?? null;
  }

  async insert(row: UpstreamInsert): Promise<UpstreamRow> {
    const [created] = await this.db.insert(upstreamServers).values(row).returning();
    if (!created) throw new Error('upstream insert returned no row');
    return created;
  }

  async update(id: string, patch: UpstreamPatch): Promise<UpstreamRow | null> {
    if (Object.keys(patch).length === 0) return this.get(id);
    const [row] = await this.db.update(upstreamServers).set(patch).where(eq(upstreamServers.id, id)).returning();
    return row ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.delete(upstreamServers).where(eq(upstreamServers.id, id)).returning({ id: upstreamServers.id });
    return deleted.length > 0;
  }

  async updateHealth(id: string, h: { lastStatus: UpstreamStatus; lastError: string | null; lastCheckedAt: Date; toolCount: number }): Promise<void> {
    await this.db.update(upstreamServers).set(h).where(eq(upstreamServers.id, id));
  }
}

/**
 * Decrypts the credential with aad = row.id (ADR-009), so a blob copied onto another row fails to open.
 * A bearer/header row without a stored credential gets an empty secret: the connection then sends no
 * credential header at all and the upstream's 401 shows up as the server's lastError.
 */
export function toUpstreamRecord(row: UpstreamRow, encKey: Buffer): UpstreamRecord {
  const secret = row.credentialEnc ? decryptSecret(row.credentialEnc, encKey, row.id) : '';
  let auth: UpstreamAuth;
  if (row.authType === 'bearer') auth = { kind: 'bearer', token: secret };
  else if (row.authType === 'header') auth = { kind: 'header', header: row.authHeaderName ?? '', value: secret };
  else auth = { kind: 'none' };
  return { id: row.id, slug: row.slug, name: row.name, url: row.url, enabled: row.enabled, auth };
}
