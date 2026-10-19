import { bigserial, boolean, customType, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** PGlite returns a Uint8Array for bytea, node-postgres a Buffer: normalise to Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
});

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  passwordHash: text('password_hash').notNull(),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('api_keys_user_id_idx').on(t.userId)],
);

export const upstreamServers = pgTable('upstream_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  authType: text('auth_type', { enum: ['none', 'bearer', 'header'] }).notNull(),
  authHeaderName: text('auth_header_name'),
  credentialEnc: bytea('credential_enc'),
  enabled: boolean('enabled').notNull().default(true),
  lastStatus: text('last_status', { enum: ['connected', 'unreachable', 'disabled', 'unknown'] })
    .notNull()
    .default('unknown'),
  lastError: text('last_error'),
  lastCheckedAt: ts('last_checked_at'),
  toolCount: integer('tool_count').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    event: text('event', { enum: ['tool_call', 'auth_rejected'] }).notNull(),
    source: text('source', { enum: ['mcp', 'chat'] }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id'),
    serverId: uuid('server_id').references(() => upstreamServers.id, { onDelete: 'set null' }),
    serverSlug: text('server_slug'),
    toolName: text('tool_name'),
    startedAt: ts('started_at').notNull().defaultNow(),
    durationMs: integer('duration_ms'),
    outcome: text('outcome', { enum: ['success', 'error', 'timeout', 'denied', 'unauthorized'] }).notNull(),
    errorMessage: text('error_message'),
  },
  (t) => [index('audit_logs_started_at_idx').on(t.startedAt), index('audit_logs_user_id_started_at_idx').on(t.userId, t.startedAt)],
);

export type User = typeof users.$inferSelect;
export type UpstreamServerRow = typeof upstreamServers.$inferSelect;
