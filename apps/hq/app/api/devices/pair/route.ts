import { DeviceError, loadDeviceSigningKey, redeemPairingCode } from '@platform/engine';

import {
  corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb,
} from '../../../../lib/api-auth';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/devices/pair — trade a code for a device token.
 *
 * The ONE unauthenticated write on the platform, and necessarily so: a tablet
 * being paired has no credential yet. Two things keep that safe.
 *
 * Every failure answers the same `pairing_unknown` -- missing, expired, already
 * redeemed, revoked. Distinguishing them would turn this into an oracle an
 * unauthenticated caller could use to learn which codes exist.
 *
 * And the code is short-lived and single-use: 15 minutes, cleared as it is
 * redeemed. The residual risk is online brute force, which is a rate-limiting
 * problem rather than a cryptographic one -- see the note in the catch.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const body = await parseJsonBody<{ code?: unknown; tenantSlug?: unknown }>(request);
  if (body instanceof Response) return body;
  const code = typeof body.code === 'string' ? body.code : '';
  const tenantSlug = typeof body.tenantSlug === 'string' ? body.tenantSlug : '';
  if (code.length === 0 || code.length > 32) {
    return jsonError(400, 'invalid_request', 'code is required.');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug) || tenantSlug.length > 80) {
    return jsonError(400, 'invalid_request', 'tenantSlug is required.');
  }

  try {
    const token = await redeemPairingCode(
      { db, key: loadDeviceSigningKey() },
      { code, expectedBrandSlug: tenantSlug },
    );
    return jsonWithCors(token, 200);
  } catch (error) {
    if (error instanceof DeviceError) {
      if (error.code === 'not_configured') {
        return jsonError(501, error.code, error.message);
      }
      // Deliberately uniform, and deliberately not counted per-code: a miss
      // finds no row to increment. Throttling belongs at the edge, per IP.
      return jsonError(400, 'pairing_unknown', 'That pairing code is not usable.');
    }
    throw error;
  }
}
