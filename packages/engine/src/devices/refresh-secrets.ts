/**
 * A screen that can re-authenticate itself.
 *
 * `refreshDeviceToken` needs a currently valid token to mint the next one,
 * which is fine for a tablet somebody touches and useless for the pickup
 * display: once its twelve hours lapse there is no path back that does not
 * involve a human editing an environment variable. The board goes dark
 * mid-service and the only fix is a deploy.
 *
 * So a device also holds a long-lived secret, stored only as an HMAC exactly
 * like a pairing code, which it trades for a short-lived token whenever it
 * needs one. The secret is what survives; the token stays twelve hours, so a
 * lost screen still dies the same shift.
 *
 * Rotation carries an overlap rather than being single-use. Single-use is
 * stronger against replay, but a screen that receives a new secret and then
 * loses the response has locked itself out of a shop nobody is standing in.
 * The outgoing secret keeps working for a bounded window instead.
 */
import { createHmac, randomBytes } from 'node:crypto';

import { DEVICE_REFRESH_COLUMNS, tokenFor } from './internal';
import { DeviceError, type DeviceDeps, type DeviceRowLike, type DeviceSigningKey, type DeviceToken } from './types';

export const REFRESH_SECRET_OVERLAP_MINUTES = 60;

/** 256 bits. Never displayed, never typed -- unlike a pairing code. */
export function newRefreshSecret(bytes: (size: number) => Buffer = randomBytes): string {
  return bytes(32).toString('base64url');
}

export function hashRefreshSecret(secret: string, key: DeviceSigningKey): string {
  return createHmac('sha256', key.secret).update(`refresh:${secret}`).digest('base64url');
}

export type DeviceRefreshSecret = {
  deviceId: string;
  /** Returned once. Never readable again -- only its HMAC is stored. */
  secret: string;
  issuedAt: string;
  /** When the secret this one replaced stops being accepted, if there was one. */
  previousExpiresAt: string | null;
};

/**
 * Mints a refresh secret for a paired device, rotating any existing one.
 *
 * Scoped by brand as well as id so a caller that has authenticated for one
 * brand cannot mint a secret for another brand's screen by guessing a uuid.
 */
export async function issueDeviceRefreshSecret(
  deps: DeviceDeps,
  input: { brandId: string; deviceId: string; overlapMinutes?: number },
): Promise<DeviceRefreshSecret> {
  const nowMs = deps.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const overlapMinutes = input.overlapMinutes ?? REFRESH_SECRET_OVERLAP_MINUTES;

  const { data, error } = await deps.db
    .from('devices')
    .select(DEVICE_REFRESH_COLUMNS)
    .eq('id', input.deviceId)
    .eq('brand_id', input.brandId)
    .maybeSingle();
  if (error) throw new DeviceError('invalid_request', error.message);
  const device = data as DeviceRowLike | null;
  if (!device || device.revoked_at !== null || device.paired_at === null) {
    throw new DeviceError('device_revoked', 'This device is not paired.');
  }

  const secret = newRefreshSecret();
  const previousHash = device.refresh_secret_hash ?? null;
  const previousExpiresAt = previousHash
    ? new Date(nowMs + overlapMinutes * 60_000).toISOString()
    : null;

  const write = deps.db
    .from('devices')
    .update({
      refresh_secret_hash: hashRefreshSecret(secret, deps.key),
      refresh_secret_issued_at: nowIso,
      refresh_secret_previous_hash: previousHash,
      refresh_secret_previous_expires_at: previousExpiresAt,
    })
    .eq('id', device.id)
    .eq('brand_id', input.brandId)
    .is('revoked_at', null);

  // Compare-and-set on the hash the read saw. Two concurrent rotations would
  // otherwise both file their own secret as current and each move the other
  // into `previous`, leaving one caller holding a secret that was never stored.
  // `.eq` cannot express IS NULL in PostgREST, so the unpaired case is `.is`.
  const updated = await (previousHash === null
    ? write.is('refresh_secret_hash', null)
    : write.eq('refresh_secret_hash', previousHash))
    .select('id')
    .maybeSingle();
  if (updated.error) throw new DeviceError('invalid_request', updated.error.message);
  if (!updated.data) throw new DeviceError('device_revoked', 'This device is not paired.');

  return { deviceId: device.id, secret, issuedAt: nowIso, previousExpiresAt };
}

/**
 * Trades a refresh secret for a token.
 *
 * Every failure answers the same `pairing_unknown`, for the reason
 * `redeemPairingCode` documents: this endpoint is reachable by an
 * unauthenticated caller holding a candidate secret, and distinguishing
 * "unknown" from "revoked" from "expired" would let them probe.
 */
export async function exchangeDeviceRefreshSecret(
  deps: DeviceDeps,
  input: { secret: string },
): Promise<DeviceToken> {
  const nowMs = deps.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const unknown = new DeviceError('pairing_unknown', 'That device credential is not usable.');
  if (typeof input.secret !== 'string' || input.secret.length < 16) throw unknown;

  // Always base64url ([A-Za-z0-9_-]) because we produced it, so it carries none
  // of the commas, dots or parens that would break out of the filter below.
  const hash = hashRefreshSecret(input.secret, deps.key);
  const { data, error } = await deps.db
    .from('devices')
    .select(DEVICE_REFRESH_COLUMNS)
    .or(`refresh_secret_hash.eq.${hash},refresh_secret_previous_hash.eq.${hash}`)
    .maybeSingle();
  if (error) throw new DeviceError('invalid_request', error.message);
  const device = data as DeviceRowLike | null;
  if (!device) throw unknown;
  if (device.revoked_at !== null) throw unknown;
  if (device.paired_at === null) throw unknown;

  // A match on the outgoing secret is only honoured inside the overlap window.
  if (device.refresh_secret_hash !== hash) {
    const expiresAt = device.refresh_secret_previous_expires_at;
    if (!expiresAt || Date.parse(expiresAt) <= nowMs) throw unknown;
  }

  const heartbeat = await deps.db
    .from('devices')
    .update({ refresh_secret_last_used_at: nowIso, last_seen_at: nowIso })
    .eq('id', device.id);
  if (heartbeat.error) throw new DeviceError('invalid_request', heartbeat.error.message);

  return tokenFor(device, deps.key, nowMs);
}
