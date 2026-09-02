/**
 * Signing and verifying the JWT a paired screen presents.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { DeviceRole } from '@platform/schema';

import type { DeviceClaims, DeviceSigningKey } from './types';

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Twelve hours: a lost tablet dies the same shift, a flaky shop wifi does not. */
export const DEVICE_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function signDeviceToken(
  claims: DeviceClaims,
  key: DeviceSigningKey,
  nowMs: number,
  ttlSeconds: number = DEVICE_TOKEN_TTL_SECONDS,
): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    // The Postgres role PostgREST assumes. Distinct from app_metadata.role,
    // which is the staff role and which a device must never carry.
    role: 'authenticated',
    aud: 'authenticated',
    iss: key.issuer,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    app_metadata: {
      brand_id: claims.brandId,
      device_id: claims.deviceId,
      device_role: claims.role,
      device_location_id: claims.locationId,
      device_token_version: claims.tokenVersion,
    },
  });
  return `${header}.${payload}.${sign(`${header}.${payload}`, key)}`;
}

/**
 * Verifies a device token, or null.
 *
 * Returns null rather than throwing for every rejection, so a caller cannot
 * accidentally distinguish "bad signature" from "expired" from "not a device
 * token" and leak that difference to an unauthenticated caller.
 */
export function verifyDeviceToken(token: string, key: DeviceSigningKey, nowMs: number): DeviceClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  const expected = sign(`${header}.${payload}`, key);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Constant time, and length-checked first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  let decoded: Record<string, unknown>;
  let head: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  // `alg: none` is the classic forgery; the signature check above already
  // fails it, but refusing the header outright means that is not the only
  // thing standing in the way.
  if (head.alg !== 'HS256') return null;
  if (typeof decoded.exp !== 'number' || decoded.exp <= Math.floor(nowMs / 1000)) return null;

  // A GoTrue staff token is ALSO HS256 with this same secret, so a signature
  // check alone does not distinguish the two issuers. GoTrue always sets `sub`
  // and never sets `device_id`; requiring both is a property of the issuers
  // rather than a convention someone could forget.
  if (decoded.sub !== undefined) return null;

  const meta = decoded.app_metadata;
  if (typeof meta !== 'object' || meta === null) return null;
  const source = meta as Record<string, unknown>;
  // Reject, do not ignore: a token claiming a staff role is a forgery attempt.
  if (source.role !== undefined) return null;

  const brandId = uuid(source.brand_id);
  const deviceId = uuid(source.device_id);
  const locationId = uuid(source.device_location_id);
  const role = deviceRole(source.device_role);
  const tokenVersion = source.device_token_version;
  if (!brandId || !deviceId || !locationId || !role) return null;
  if (typeof tokenVersion !== 'number' || !Number.isInteger(tokenVersion)) return null;

  return { brandId, deviceId, locationId, role, tokenVersion };
}

/** Roles that may place an order. A display or prep tablet may not. */
export const ORDERING_DEVICE_ROLES: readonly DeviceRole[] = ['kiosk', 'pos'];

export function canPlaceOrders(role: DeviceRole): boolean {
  return ORDERING_DEVICE_ROLES.includes(role);
}

function sign(data: string, key: DeviceSigningKey): string {
  return createHmac('sha256', key.secret).update(data).digest('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

const ROLES: readonly DeviceRole[] = ['kiosk', 'pos', 'display', 'prep'];
function deviceRole(value: unknown): DeviceRole | null {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
    ? (value as DeviceRole)
    : null;
}
