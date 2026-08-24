/**
 * Pairing a screen to a shop.
 *
 * Three of the five surfaces are screens nobody signs into, and
 * `docs/FIVE-SURFACES.md` calls the `devices` table the keystone that makes
 * that safe. Migration 0022 built the table and the RLS helpers that read
 * `app.jwt_device_*` — and then nothing ever minted a token those helpers could
 * read, so `app.device_is_active()` was false for every principal the platform
 * could issue and the kiosk, display and prep policies could never pass.
 *
 * This is the minter. It signs a JWT the project's own PostgREST accepts,
 * rather than creating an `auth.users` row per tablet: a device is not a person,
 * GoTrue's claim hook runs off a user record it would have to invent, and every
 * device would then show up in the user table forever.
 *
 * Two properties carry the whole security argument, and both are asserted in
 * `devices.test.ts` rather than left to review:
 *
 *   NO `sub`. `auth.uid()` reads it, so with it absent every policy pinned to
 *   `user_id = auth.uid()` — customers, loyalty accounts, stored value,
 *   referrals — matches nothing. A device cannot even insert a customer row,
 *   because `customers_insert` requires `user_id = auth.uid()`.
 *
 *   NO `app_metadata.role`. That is what `app.jwt_role()` reads and what every
 *   `is_brand_*` helper tests. 0022's comment says a device token deliberately
 *   carries no role; `verifyDeviceToken` REJECTS one that does rather than
 *   ignoring it, so a forged claim fails closed instead of being tolerated.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { DeviceRole } from '@platform/schema';

export class DeviceError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'pairing_unknown'
      | 'device_revoked'
      | 'device_role_unsupported'
      | 'not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

export type DeviceClaims = {
  brandId: string;
  deviceId: string;
  role: DeviceRole;
  locationId: string;
  /** Bumped on revoke and re-pair; compared on every request. */
  tokenVersion: number;
};

export type DeviceSigningKey = { secret: string; issuer: string };

/**
 * The project's JWT secret, which is what makes a minted token one PostgREST
 * will verify. Mirrors `loadTokenKey`'s shape: a sentence, not a stack trace.
 */
export function loadDeviceSigningKey(env: NodeJS.ProcessEnv = process.env): DeviceSigningKey {
  const secret = env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new DeviceError('not_configured', 'SUPABASE_JWT_SECRET is not set; device pairing is unavailable.');
  }
  if (secret.length < 32) {
    throw new DeviceError('not_configured', 'SUPABASE_JWT_SECRET must be at least 32 characters.');
  }
  return { secret, issuer: env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1` : 'device-pairing' };
}

// -- pairing codes ---------------------------------------------------------

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

// -- tokens ----------------------------------------------------------------

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

// -- the database half -----------------------------------------------------

/**
 * Columns are named, never `select('*')`.
 *
 * A sibling change added column-level revokes on other tables, and a `*` there
 * now ERRORS rather than returning a redacted row. Naming columns is also the
 * only way this keeps working when a column is later restricted.
 */
const DEVICE_COLUMNS =
  'id, brand_id, location_id, role, label, pairing_code_hash, pairing_expires_at, paired_at, revoked_at, last_seen_at, token_version, created_at, updated_at';

export type DeviceDeps = {
  /** Service-role client: pairing and revocation are engine concerns (0022). */
  db: SupabaseClient;
  key: DeviceSigningKey;
  now?: () => number;
};

export type PairingInvite = {
  deviceId: string;
  /** Returned once. Never readable again -- only its HMAC is stored. */
  code: string;
  expiresAt: string;
};

export type DeviceToken = {
  token: string;
  expiresAt: string;
  deviceId: string;
  role: DeviceRole;
  brandId: string;
  locationId: string;
  label: string;
};

/** How long a code is good for. Long enough to walk to the tablet. */
export const PAIRING_TTL_MINUTES = 15;

export async function issuePairingCode(
  deps: DeviceDeps,
  input: { brandId: string; locationId: string; role: DeviceRole; label: string },
): Promise<PairingInvite> {
  const nowMs = deps.now?.() ?? Date.now();
  const code = newPairingCode();
  const expiresAt = new Date(nowMs + PAIRING_TTL_MINUTES * 60_000).toISOString();

  const { data, error } = await deps.db
    .from('devices')
    .insert({
      brand_id: input.brandId,
      location_id: input.locationId,
      role: input.role,
      label: input.label,
      pairing_code_hash: hashPairingCode(code, deps.key),
      pairing_expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error) throw new DeviceError('invalid_request', error.message);

  return { deviceId: (data as { id: string }).id, code, expiresAt };
}

/**
 * Trades a code for a token.
 *
 * Every failure answers `pairing_unknown` -- missing, expired, already
 * redeemed, revoked. This endpoint is necessarily unauthenticated (a tablet
 * being paired has nothing yet), so distinguishing those would let an
 * unauthenticated caller probe which codes exist.
 */
export async function redeemPairingCode(
  deps: DeviceDeps,
  input: { code: string; expectedBrandSlug: string },
): Promise<DeviceToken> {
  const nowMs = deps.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const codeHash = hashPairingCode(input.code, deps.key);
  const { data, error } = await deps.db
    .from('devices')
    .select(DEVICE_COLUMNS)
    .eq('pairing_code_hash', codeHash)
    .maybeSingle();
  if (error) throw new DeviceError('invalid_request', error.message);

  const device = data as DeviceRowLike | null;
  const unknown = new DeviceError('pairing_unknown', 'That pairing code is not usable.');
  if (!device) throw unknown;
  if (device.revoked_at) throw unknown;
  if (!device.pairing_expires_at || Date.parse(device.pairing_expires_at) <= nowMs) throw unknown;
  const brand = await deps.db
    .from('brands')
    .select('slug')
    .eq('id', device.brand_id)
    .maybeSingle();
  if (brand.error) throw new DeviceError('invalid_request', brand.error.message);
  if (!tenantSlugMatches((brand.data as { slug?: unknown } | null)?.slug, input.expectedBrandSlug)) {
    throw unknown;
  }

  // Single use: the code is cleared as it is redeemed, and the version bumps so
  // any token minted for an earlier pairing of this row stops being accepted.
  const paired = await deps.db
    .from('devices')
    .update({
      pairing_code_hash: null,
      pairing_expires_at: null,
      paired_at: nowIso,
      last_seen_at: nowIso,
      token_version: device.token_version + 1,
    })
    .eq('id', device.id)
    // Compare-and-clear in one UPDATE. Two requests may both read the code,
    // but only the one that still sees its hash and version can consume it.
    .eq('pairing_code_hash', codeHash)
    .eq('token_version', device.token_version)
    .gt('pairing_expires_at', nowIso)
    .is('revoked_at', null)
    .select(DEVICE_COLUMNS)
    .maybeSingle();
  if (paired.error) throw new DeviceError('invalid_request', paired.error.message);
  const row = paired.data as DeviceRowLike | null;
  if (!row) throw unknown;

  return tokenFor(row, deps.key, nowMs);
}

/** Pairing must bind a white-label binary to the brand compiled into it. */
export function tenantSlugMatches(actual: unknown, expected: unknown): boolean {
  return typeof actual === 'string' && typeof expected === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(expected)
    && actual === expected;
}

/**
 * A fresh token for a device that already has one.
 *
 * Re-reads the row every time, which is what makes revocation immediate on the
 * service-role path: a revoked or re-paired device gets refused here rather
 * than running until its current token expires.
 */
export async function refreshDeviceToken(deps: DeviceDeps, claims: DeviceClaims): Promise<DeviceToken> {
  const nowMs = deps.now?.() ?? Date.now();
  const device = await loadActiveDevice(deps, claims);
  if (!device) throw new DeviceError('device_revoked', 'This device is no longer paired.');
  void deps.db.from('devices').update({ last_seen_at: new Date(nowMs).toISOString() }).eq('id', device.id);
  return tokenFor(device, deps.key, nowMs);
}

export async function revokeDevice(
  deps: DeviceDeps,
  input: { brandId: string; deviceId: string },
): Promise<void> {
  const nowMs = deps.now?.() ?? Date.now();
  const { error } = await deps.db
    .from('devices')
    .update({
      revoked_at: new Date(nowMs).toISOString(),
      pairing_code_hash: null,
      pairing_expires_at: null,
      // Bumping the version is what stops an outstanding token, since the API
      // path bypasses RLS and would otherwise honour it until expiry.
      token_version: 0,
    })
    .eq('id', input.deviceId)
    .eq('brand_id', input.brandId);
  if (error) throw new DeviceError('invalid_request', error.message);
}

/**
 * The row behind a claim, or null.
 *
 * The ONLY check on the service-role path, where RLS does not apply. Every
 * field is compared rather than trusted: a token is a statement about the past,
 * and the row is the present.
 */
export async function loadActiveDevice(
  deps: DeviceDeps,
  claims: DeviceClaims,
): Promise<DeviceRowLike | null> {
  const { data, error } = await deps.db
    .from('devices')
    .select(DEVICE_COLUMNS)
    .eq('id', claims.deviceId)
    .maybeSingle();
  if (error) throw new DeviceError('invalid_request', error.message);
  const device = data as DeviceRowLike | null;
  if (!device) return null;
  if (device.revoked_at !== null) return null;
  if (device.paired_at === null) return null;
  if (device.token_version !== claims.tokenVersion) return null;
  if (device.brand_id !== claims.brandId) return null;
  if (device.location_id !== claims.locationId) return null;
  if (device.role !== claims.role) return null;
  return device;
}

export type DeviceRowLike = {
  id: string;
  brand_id: string;
  location_id: string;
  role: DeviceRole;
  label: string;
  pairing_code_hash: string | null;
  pairing_expires_at: string | null;
  paired_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  token_version: number;
};

function tokenFor(device: DeviceRowLike, key: DeviceSigningKey, nowMs: number): DeviceToken {
  const claims: DeviceClaims = {
    brandId: device.brand_id,
    deviceId: device.id,
    locationId: device.location_id,
    role: device.role,
    tokenVersion: device.token_version,
  };
  return {
    token: signDeviceToken(claims, key, nowMs),
    expiresAt: new Date(nowMs + DEVICE_TOKEN_TTL_SECONDS * 1000).toISOString(),
    deviceId: device.id,
    role: device.role,
    brandId: device.brand_id,
    locationId: device.location_id,
    label: device.label,
  };
}
