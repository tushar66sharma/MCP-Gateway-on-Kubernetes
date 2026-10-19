import { Algorithm, hash, verify } from '@node-rs/argon2';

export function hashPassword(p: string): Promise<string> {
  return hash(p, { algorithm: Algorithm.Argon2id });
}

export async function verifyPassword(hashed: string, p: string): Promise<boolean> {
  try {
    return await verify(hashed, p);
  } catch {
    return false;
  }
}
