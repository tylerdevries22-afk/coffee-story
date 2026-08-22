/**
 * One key per checkout attempt: the server upserts on (brand, client_key), so
 * a retried request returns the existing order instead of charging twice.
 *
 * crypto.randomUUID exists on modern Hermes and every browser/node this runs
 * in; the fallback keeps old runtimes working. An idempotency key needs
 * uniqueness, not secrecy, so Math.random is an acceptable last resort.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
