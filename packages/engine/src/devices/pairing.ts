/**
 * The pairing handshake: a manager-issued code in, a device token out.
 */
import type { DeviceRole } from '@platform/schema';

import { hashPairingCode, newPairingCode } from './pairing-codes';
import { DEVICE_COLUMNS, tokenFor } from './internal';
import { DeviceError, type DeviceDeps, type DeviceRowLike, type DeviceToken } from './types';

export type PairingInvite = {
  deviceId: string;
  /** Returned once. Never readable again -- only its HMAC is stored. */
  code: string;
  expiresAt: string;
};

/** How long a code is good for. Long enough to walk to the tablet. */
export const PAIRING_TTL_MINUTES = 10;

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
