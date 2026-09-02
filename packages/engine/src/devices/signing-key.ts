/**
 * The key a device token is minted and verified with.
 */
import { DeviceError, type DeviceSigningKey } from './types';

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
