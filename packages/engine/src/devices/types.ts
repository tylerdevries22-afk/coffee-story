/**
 * Shared device types and the DeviceError every device module raises.
 */
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

export type DeviceDeps = {
  /** Service-role client: pairing and revocation are engine concerns (0022). */
  db: SupabaseClient;
  key: DeviceSigningKey;
  now?: () => number;
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
  refresh_secret_hash?: string | null;
  refresh_secret_issued_at?: string | null;
  refresh_secret_previous_hash?: string | null;
  refresh_secret_previous_expires_at?: string | null;
  refresh_secret_last_used_at?: string | null;
};
