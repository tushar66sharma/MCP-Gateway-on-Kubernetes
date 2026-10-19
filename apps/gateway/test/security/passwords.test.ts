import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/security/passwords.js';

describe('passwords', () => {
  it('verifies correct and rejects wrong', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong password!!')).toBe(false);
  });
  it('returns false for malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
