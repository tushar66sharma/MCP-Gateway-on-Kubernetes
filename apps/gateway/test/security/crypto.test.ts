import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, generateApiKey, randomToken, sha256Hex } from '../../src/security/crypto.js';

describe('crypto', () => {
  const key = randomBytes(32);

  it('round-trips', () => {
    expect(decryptSecret(encryptSecret('hello', key, 'row-1'), key, 'row-1')).toBe('hello');
  });

  it('throws when any byte is flipped', () => {
    const blob = encryptSecret('hello', key, 'row-1');
    for (let i = 0; i < blob.length; i++) {
      const bad = Buffer.from(blob);
      bad[i] = (bad[i] ?? 0) ^ 0xff;
      expect(() => decryptSecret(bad, key, 'row-1')).toThrow();
    }
  });

  it('throws on wrong aad and short blob', () => {
    const blob = encryptSecret('hello', key, 'row-1');
    expect(() => decryptSecret(blob, key, 'row-2')).toThrow();
    expect(() => decryptSecret(Buffer.alloc(10), key, 'row-1')).toThrow();
  });

  it('uses a unique nonce', () => {
    expect(encryptSecret('x', key, 'a').equals(encryptSecret('x', key, 'a'))).toBe(false);
  });

  it('generates api keys', () => {
    const k = generateApiKey();
    expect(k.plaintext).toMatch(/^ugw_[0-9A-Za-z]{43}$/);
    expect(k.prefix).toBe(k.plaintext.slice(0, 12));
    expect(k.hash).toBe(sha256Hex(k.plaintext));
    expect(new Set(Array.from({ length: 50 }, () => generateApiKey().plaintext)).size).toBe(50);
  });

  it('randomToken is base64url', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
