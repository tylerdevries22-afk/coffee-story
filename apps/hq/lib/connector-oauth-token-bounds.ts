export const MAX_CONNECTOR_CREDENTIAL_BYTES = 20_000;
export const MAX_CONNECTOR_CLEANUP_CREDENTIAL_BYTES = 24_576;
const MIN_TOKEN_BYTES = 8;
const MAX_TOKEN_BYTES = 16_384;

export function connectorUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isBoundedConnectorToken(value: string | null | undefined): value is string {
  if (!value) return false;
  const bytes = connectorUtf8Bytes(value);
  return bytes >= MIN_TOKEN_BYTES && bytes <= MAX_TOKEN_BYTES;
}

export function isBoundedConnectorCredential(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === 'string'
      && connectorUtf8Bytes(encoded) <= MAX_CONNECTOR_CREDENTIAL_BYTES;
  } catch {
    return false;
  }
}

export function isBoundedConnectorCleanupCredential(value: unknown): boolean {
  const bytes = connectorCredentialBytes(value);
  return bytes !== null && bytes <= MAX_CONNECTOR_CLEANUP_CREDENTIAL_BYTES;
}

export function connectorCredentialBytes(value: unknown): number | null {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === 'string' ? connectorUtf8Bytes(encoded) : null;
  } catch {
    return null;
  }
}

export function isBoundedConnectorIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value
    && connectorUtf8Bytes(value) >= 1 && connectorUtf8Bytes(value) <= 512;
}
