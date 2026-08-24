export type StoredDeviceToken = {
  token: string;
  expiresAt: string;
  deviceId: string;
  role: string;
  brandId: string;
  locationId: string;
  label: string;
  /** Compiled tenant that was server-validated when this token was paired. */
  tenantSlug: string;
};

export type CredentialOperation = Readonly<{
  generation: number;
  token: string | null;
}>;

const DEVICE_ROLES = new Set(['kiosk', 'pos', 'display', 'prep']);

/** Secure storage is an untyped boundary; a cast here could grant a corrupt
 * record the same posture as a paired tablet. */
export function parseStoredDeviceToken(value: unknown): StoredDeviceToken | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const required = ['token', 'expiresAt', 'deviceId', 'role', 'brandId', 'locationId', 'label', 'tenantSlug'] as const;
  if (required.some((key) => typeof record[key] !== 'string' || record[key].length === 0)) return null;
  if (!DEVICE_ROLES.has(record.role as string)) return null;
  if (!Number.isFinite(Date.parse(record.expiresAt as string))) return null;
  return {
    token: record.token as string,
    expiresAt: record.expiresAt as string,
    deviceId: record.deviceId as string,
    role: record.role as string,
    brandId: record.brandId as string,
    locationId: record.locationId as string,
    label: record.label as string,
    tenantSlug: record.tenantSlug as string,
  };
}

/** Refresh well before expiry: a shop's wifi is not a data centre's. */
export function needsRefresh(value: StoredDeviceToken, nowMs: number): boolean {
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(expires)) return true;
  return expires - nowMs < 60 * 60 * 1000;
}

export function isExpired(value: StoredDeviceToken, nowMs: number): boolean {
  const expires = Date.parse(value.expiresAt);
  return !Number.isFinite(expires) || expires <= nowMs;
}

/** Capture the credential identity an async operation is acting on. */
export function captureCredentialOperation(generation: number, token: string | null): CredentialOperation {
  return { generation, token };
}

/** Invalidate every operation captured against the preceding credential. */
export function nextCredentialGeneration(generation: number): number {
  return generation + 1;
}

/** A refresh may commit only while both its generation and bearer are current. */
export function isCredentialOperationCurrent(
  operation: CredentialOperation,
  generation: number,
  token: string | null,
): boolean {
  return operation.generation === generation && operation.token === token;
}
