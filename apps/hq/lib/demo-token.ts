/**
 * The link a prospect receives is the whole credential: whoever holds it can
 * view that one demo, and nothing else. So it is long enough to be unguessable
 * (256 random bits, base64url, 43 characters), it is checked for shape before
 * anything touches the database, and only its SHA-256 is ever stored -- the
 * database can confirm a link without being able to produce one.
 */
import { createHash, randomBytes } from 'node:crypto';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newDemoToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isDemoToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function demoTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
