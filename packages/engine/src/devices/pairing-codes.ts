/**
 * Pairing codes: eight characters read off a screen, stored only as an HMAC.
 */
import { createHmac, randomInt } from 'node:crypto';

import type { DeviceSigningKey } from './types';

/**
 * Crockford base32 minus vowels: no I/O/0/1 to misread off a screen, and no
 * vowels so a code can never spell a word a barista has to say out loud.
 */
const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXZ';
const CODE_LENGTH = 8;

export function newPairingCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Codes are stored hashed, never in plaintext.
 *
 * `devices_select` (0022) is `app.is_brand_staff(brand_id)` — brand-wide, and
 * that helper includes `role = 'staff'`. So a plaintext column meant any
 * barista could read the pairing code for any location of the brand and pair
 * their own hardware as a kiosk. The code now exists only in the HTTP response
 * that minted it.
 */
export function hashPairingCode(code: string, key: DeviceSigningKey): string {
  return createHmac('sha256', key.secret).update(`pairing:${normalizeCode(code)}`).digest('base64url');
}

/** Case and spacing are how a code gets read aloud, not part of the secret. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
