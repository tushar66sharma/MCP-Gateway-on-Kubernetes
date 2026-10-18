export type Period = 'today' | 'yesterday' | 'last_7_days';
export const PERIODS: readonly Period[] = ['today', 'yesterday', 'last_7_days'];

/** Milliseconds the zone is ahead of UTC at a given instant (e.g. +19800000 for Asia/Kolkata). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of local midnight for the given calendar date in the zone (DST-safe). */
function startOfLocalDay(year: number, month: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

function localCalendarDate(instant: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** [after, before) bounds of a period in the store's time zone, as UTC ISO strings. */
export function resolvePeriod(period: Period, timeZone: string, now: Date = new Date()): { after: string; before: string } {
  const { y, m, d } = localCalendarDate(now.getTime(), timeZone);
  const dayStart = (offsetDays: number): number => {
    const date = new Date(Date.UTC(y, m - 1, d + offsetDays));
    return startOfLocalDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), timeZone);
  };
  const iso = (ms: number): string => new Date(ms).toISOString();
  switch (period) {
    case 'today':
      return { after: iso(dayStart(0)), before: iso(dayStart(1)) };
    case 'yesterday':
      return { after: iso(dayStart(-1)), before: iso(dayStart(0)) };
    case 'last_7_days':
      return { after: iso(dayStart(-6)), before: iso(dayStart(1)) };
  }
}
