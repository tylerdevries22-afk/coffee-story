/**
 * AES-256-GCM for Square OAuth tokens at rest (rule 3). The key is
 * SQUARE_TOKEN_KEY, 32 bytes base64, held only by the server environment --
 * the database stores ciphertext, an app bundle never sees any of it.
 *
 * Format: base64(iv[12] || ciphertext || authTag[16]), versioned with a
 * leading "v1:" so a future rotation can tell blobs apart.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1:';

export function loadTokenKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.SQUARE_TOKEN_KEY;
  if (!raw) throw new Error('SQUARE_TOKEN_KEY is not set (32 bytes, base64).');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SQUARE_TOKEN_KEY must decode to exactly 32 bytes.');
  return key;
}

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION + Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decryptToken(blob: string, key: Buffer): string {
  if (!blob.startsWith(VERSION)) throw new Error('Unknown token blob version.');
  const raw = Buffer.from(blob.slice(VERSION.length), 'base64');
  if (raw.length < 12 + 16) throw new Error('Token blob too short.');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
