import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const NONCE_LEN = 12;
const TAG_LEN = 16;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function base62(buf: Buffer, width: number): string {
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(width, '0');
}

export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `ugw_${base62(randomBytes(32), 43)}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: sha256Hex(plaintext) };
}

/** Layout: nonce(12) | ciphertext | tag(16). AES-256-GCM; AAD binds the blob to its row. */
export function encryptSecret(plain: string, key: Buffer, aad: string): Buffer {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]);
}

export function decryptSecret(blob: Buffer, key: Buffer, aad: string): string {
  if (blob.length < NONCE_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const nonce = blob.subarray(0, NONCE_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(NONCE_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
