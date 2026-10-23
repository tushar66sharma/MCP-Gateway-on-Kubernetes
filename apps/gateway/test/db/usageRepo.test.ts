import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../../src/auth/users.js';
import type { DbHandle } from '../../src/db/client.js';
import { addUsage, budgetDay, getUsage, nextResetAt } from '../../src/chat/usageRepo.js';
import { createTestDb } from '../helpers/testDb.js';

describe('budget day', () => {
  it('budget day rolls over at midnight in the store time zone', () => {
    // Asia/Kolkata is UTC+5:30: 23:59 on 2026-10-23 there is 18:29 UTC, 00:01 on the 24th is 18:31 UTC.
    expect(budgetDay(new Date('2026-10-23T18:29:00Z'), 'Asia/Kolkata')).toBe('2026-10-23');
    expect(budgetDay(new Date('2026-10-23T18:31:00Z'), 'Asia/Kolkata')).toBe('2026-10-24');
    expect(budgetDay(new Date('2026-10-23T18:31:00Z'), 'UTC')).toBe('2026-10-23');
  });

  it('nextResetAt is the next 00:00 in the zone', () => {
    expect(nextResetAt(new Date('2026-10-23T18:29:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-10-23T18:30:00.000Z');
    expect(nextResetAt(new Date('2026-10-23T18:30:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-10-24T18:30:00.000Z');
    expect(nextResetAt(new Date('2026-10-23T10:00:00Z'), 'UTC').toISOString()).toBe('2026-10-24T00:00:00.000Z');
  });

  it('nextResetAt follows daylight saving', () => {
    // America/New_York leaves DST on 2026-11-01 (UTC-4 -> UTC-5).
    expect(nextResetAt(new Date('2026-11-01T12:00:00Z'), 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(nextResetAt(new Date('2026-10-31T12:00:00Z'), 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

describe('usage repository', () => {
  let db: DbHandle;
  let userId: string;
  beforeAll(async () => {
    db = await createTestDb();
    userId = (await createUser(db.db, { email: 'u@example.com', role: 'member', name: 'U', password: 'password-12345' })).id;
  });
  afterAll(async () => {
    await db.close();
  });

  it('getUsage is 0 without a row', async () => {
    expect(await getUsage(db.db, userId, '2026-10-23')).toBe(0);
  });

  it('addUsage increments atomically', async () => {
    await Promise.all([addUsage(db.db, userId, '2026-10-24', 100), addUsage(db.db, userId, '2026-10-24', 250)]);
    expect(await getUsage(db.db, userId, '2026-10-24')).toBe(350);
    expect(await getUsage(db.db, userId, '2026-10-25')).toBe(0);
  });
});
