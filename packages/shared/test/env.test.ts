import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, loadEnv } from '../src/env.js';

const schema = z.object({ PORT: z.coerce.number().int().positive(), TOKEN: z.string().min(16) });

describe('loadEnv', () => {
  it('throws EnvValidationError naming every bad variable, never values', () => {
    let caught: unknown;
    try {
      loadEnv(schema, { PORT: 'abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const e = caught as EnvValidationError;
    expect(e.message).toContain('PORT');
    expect(e.message).toContain('TOKEN');
    expect(e.message).not.toContain('abc');
    expect(e.issues.length).toBe(2);
  });

  it('does not leak a too-short secret value', () => {
    let caught: unknown;
    try {
      loadEnv(schema, { PORT: '1', TOKEN: 'short-secret' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as Error).message).toContain('TOKEN');
    expect((caught as Error).message).not.toContain('short-secret');
  });

  it('returns parsed values with coercion', () => {
    const out = loadEnv(schema, { PORT: '3001', TOKEN: '0123456789abcdef' });
    expect(out).toEqual({ PORT: 3001, TOKEN: '0123456789abcdef' });
  });
});
