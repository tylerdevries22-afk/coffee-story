import {
  MAX_JOBS,
  MAX_PAYLOAD_CHUNKS,
  MAX_PRINTED_IDS,
  type PrintScope,
  type PrintStorage,
} from './print-outbox';

/**
 * Where the print queue lives on the device, and what its unencrypted half is
 * allowed to say.
 *
 * The index names jobs and counts chunks; the guest, the lines, the total and
 * the tender live in SecureStore. Keeping the key shapes and the index parser
 * here is what lets `print-outbox-storage.ts` stay inside the size rule.
 */

export const INDEX_PREFIX = 'platform:operator-print-outbox:v2';
export const PAYLOAD_PREFIX = 'platform.operator.print.v2';
export const INDEX_VERSION = 2;

/** The v1 key: one plaintext blob per location. Removed, never migrated. */
export const LEGACY_INDEX_PREFIX = 'platform:operator-print-outbox:';

/** AsyncStorage, plus the key listing a brand-wide or device-wide wipe needs. */
export type PrintIndexStorage = PrintStorage & {
  getAllKeys: () => Promise<readonly string[]>;
};

/** Compatible with Expo SecureStore; each key holds one chunk of one job. */
export type PrintSecureStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

export type IndexEntry = { id: string; orderId: string; chunks: number };
export type StoredIndex = { version: number; entries: IndexEntry[]; printedIds: string[] };

/**
 * SecureStore keys accept alphanumerics, `.`, `-` and `_`. Ids reaching here
 * come from JWT claims and database rows, so they are validated rather than
 * rewritten: a scope that cannot be spelled safely stores nothing at all
 * instead of colliding with a neighbouring scope's key.
 */
export const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export function safeScope(scope: PrintScope): boolean {
  return SAFE_SEGMENT.test(scope.brandId) && SAFE_SEGMENT.test(scope.locationId);
}

export function indexKey(scope: PrintScope): string {
  return `${INDEX_PREFIX}:${scope.brandId}:${scope.locationId}`;
}

export function chunkKey(scope: PrintScope, orderId: string, chunk: number): string {
  return `${PAYLOAD_PREFIX}.${scope.brandId}.${scope.locationId}.${orderId}.${chunk}`;
}

export function scopeFromIndexKey(key: string): PrintScope | null {
  const parts = key.split(':');
  // "platform:operator-print-outbox:v2:<brand>:<location>"
  if (parts.length !== 5 || parts[2] !== 'v2') return null;
  const scope = { brandId: parts[3] ?? '', locationId: parts[4] ?? '' };
  return safeScope(scope) ? scope : null;
}

/** Parses the index, or nothing at all: a half-understood index is not a queue. */
export function parseIndex(raw: string | null): StoredIndex | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredIndex>;
    if (value.version !== INDEX_VERSION || !Array.isArray(value.entries) || !Array.isArray(value.printedIds)) {
      return null;
    }
    const entries = value.entries.filter((entry): entry is IndexEntry => Boolean(entry)
      && typeof entry.id === 'string' && typeof entry.orderId === 'string'
      && Number.isInteger(entry.chunks) && entry.chunks > 0 && entry.chunks <= MAX_PAYLOAD_CHUNKS
      && SAFE_SEGMENT.test(entry.orderId));
    if (entries.length !== value.entries.length) return null;
    return {
      version: INDEX_VERSION,
      entries: entries.slice(-MAX_JOBS),
      printedIds: value.printedIds.filter((id): id is string => typeof id === 'string').slice(-MAX_PRINTED_IDS),
    };
  } catch {
    return null;
  }
}
