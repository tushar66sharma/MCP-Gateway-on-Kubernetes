import { describe, expect, it } from 'vitest';
import { PERIODS, resolvePeriod } from '../src/period.js';

const now = new Date('2026-10-18T20:00:00Z');

describe('resolvePeriod', () => {
  it('exposes the periods', () => {
    expect(PERIODS).toEqual(['today', 'yesterday', 'last_7_days']);
  });
  it('today in Asia/Kolkata (already the 19th locally)', () => {
    expect(resolvePeriod('today', 'Asia/Kolkata', now)).toEqual({ after: '2026-10-18T18:30:00.000Z', before: '2026-10-19T18:30:00.000Z' });
  });
  it('yesterday in Asia/Kolkata', () => {
    expect(resolvePeriod('yesterday', 'Asia/Kolkata', now)).toEqual({ after: '2026-10-17T18:30:00.000Z', before: '2026-10-18T18:30:00.000Z' });
  });
  it('last_7_days in Asia/Kolkata', () => {
    expect(resolvePeriod('last_7_days', 'Asia/Kolkata', now)).toEqual({ after: '2026-10-12T18:30:00.000Z', before: '2026-10-19T18:30:00.000Z' });
  });
  it('today in UTC', () => {
    expect(resolvePeriod('today', 'UTC', new Date('2026-10-18T00:00:00Z'))).toEqual({
      after: '2026-10-18T00:00:00.000Z', before: '2026-10-19T00:00:00.000Z',
    });
  });
  it('handles the DST-end day in America/New_York', () => {
    expect(resolvePeriod('today', 'America/New_York', new Date('2026-11-01T12:00:00Z'))).toEqual({
      after: '2026-11-01T04:00:00.000Z', before: '2026-11-02T05:00:00.000Z',
    });
  });
  it('throws RangeError for an invalid zone', () => {
    expect(() => resolvePeriod('today', 'Not/AZone', now)).toThrow(RangeError);
  });
});
