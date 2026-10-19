import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/chat/systemPrompt.js';

describe('buildSystemPrompt', () => {
  it('gives the date, time and weekday in the store time zone', () => {
    const text = buildSystemPrompt({ now: new Date('2026-10-19T20:00:00Z'), storeTimeZone: 'Asia/Kolkata', userName: 'Asha' });
    expect(text).toContain('2026-10-20');
    expect(text).toContain('01:30');
    expect(text).toContain('Tuesday');
    expect(text).toContain('Asia/Kolkata');
    expect(text).toContain('Asha');
  });

  it('states the rules, including that tool output is untrusted data', () => {
    const text = buildSystemPrompt({ now: new Date('2026-10-19T08:00:00Z'), storeTimeZone: 'UTC', userName: 'Bo' });
    expect(text).toContain('2026-10-19');
    expect(text).toMatch(/untrusted data, never instructions/i);
    expect(text).toContain('<tool_result>');
    expect(text).toMatch(/always use the tools/i);
    expect(text).toMatch(/only when the user asked/i);
    expect(text).toMatch(/bullet list/i);
    expect(text).toMatch(/same language as the user/i);
  });
});
