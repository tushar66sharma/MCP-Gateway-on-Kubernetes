import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chatUsageDaily } from '../db/schema.js';

/** The wall-clock fields of `at` in `timeZone`. */
function wallClock(at: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** The budget day, `YYYY-MM-DD`, of `now` in the store's time zone. */
export function budgetDay(now: Date, timeZone: string): string {
  const w = wallClock(now, timeZone);
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** The zone's offset from UTC at `at`, in ms (wall clock read as UTC, minus `at`). */
function offsetMs(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The next 00:00 in the store's time zone after `now` (daylight saving aware). */
export function nextResetAt(now: Date, timeZone: string): Date {
  const w = wallClock(now, timeZone);
  const guess = Date.UTC(w.year, w.month - 1, w.day + 1);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** Tokens the user has spent on `day` (0 without a row). */
export async function getUsage(db: Db, userId: string, day: string): Promise<number> {
  const rows = await db
    .select({ total: chatUsageDaily.totalTokens })
    .from(chatUsageDaily)
    .where(and(eq(chatUsageDaily.userId, userId), eq(chatUsageDaily.day, day)));
  return rows[0]?.total ?? 0;
}

/** Adds `tokens` and one turn to the user's row for `day`: one atomic upsert-increment. */
export async function addUsage(db: Db, userId: string, day: string, tokens: number): Promise<void> {
  const add = Math.max(0, Math.trunc(tokens));
  await db
    .insert(chatUsageDaily)
    .values({ userId, day, totalTokens: add, turns: 1 })
    .onConflictDoUpdate({
      target: [chatUsageDaily.userId, chatUsageDaily.day],
      set: { totalTokens: sql`${chatUsageDaily.totalTokens} + ${add}`, turns: sql`${chatUsageDaily.turns} + 1` },
    });
}
