import { isJob } from './print-outbox-guards';
import {
  MAX_PRINTED_IDS,
  SECURE_CHUNK_BYTES,
  chunkByUtf8Bytes,
  expirePrintJobs,
  printJobFits,
  printJobPayload,
  type PrintJob,
  type PrintOutbox,
  type PrintScope,
  type PrintStorage,
} from './print-outbox';
import {
  INDEX_PREFIX,
  INDEX_VERSION,
  LEGACY_INDEX_PREFIX,
  SAFE_SEGMENT,
  chunkKey,
  indexKey,
  parseIndex,
  safeScope,
  scopeFromIndexKey,
  type IndexEntry,
  type PrintIndexStorage,
  type PrintSecureStorage,
} from './print-outbox-keys';

export type { PrintIndexStorage, PrintSecureStorage } from './print-outbox-keys';

/**
 * Durable storage for the local print queue.
 *
 * The queue used to be one plaintext AsyncStorage value per location, holding
 * the guest's name, every line and note, the total and the tender type. Two
 * things were wrong with that beyond the plaintext: the key named only the
 * location, so a brand-keyed purge on a tenant switch could not find it, and
 * nothing ever aged a job out.
 *
 * The shape now follows `operations/persistent-intents.ts`: an ordered index
 * in AsyncStorage naming the jobs, the job payloads in SecureStore, and the
 * write order payloads -> index -> delete orphans, so a crash mid-save leaves
 * unreferenced payloads rather than an index pointing at nothing. Only the
 * index is readable without the keychain, and it holds ids and counts, never
 * a guest or an order.
 */

async function readJob(
  secureStorage: PrintSecureStorage,
  scope: PrintScope,
  entry: IndexEntry,
): Promise<PrintJob | null> {
  const chunks = await Promise.all(Array.from({ length: entry.chunks }, (_value, index) =>
    secureStorage.getItemAsync(chunkKey(scope, entry.orderId, index))));
  if (chunks.some((chunk) => chunk === null)) return null;
  try {
    const job = JSON.parse(chunks.join('')) as unknown;
    return isJob(job) && job.id === entry.id ? job : null;
  } catch {
    return null;
  }
}

/** Reads one scope's queue, dropping anything unreadable, mismatched or expired. */
export async function loadPrintOutbox(
  indexStorage: PrintStorage,
  secureStorage: PrintSecureStorage,
  scope: PrintScope,
  now: number = Date.now(),
): Promise<PrintOutbox> {
  const empty: PrintOutbox = { jobs: [], printedIds: [] };
  if (!safeScope(scope)) return empty;
  try {
    const index = parseIndex(await indexStorage.getItem(indexKey(scope)));
    if (!index) return empty;
    const jobs = await Promise.all(index.entries.map((entry) => readJob(secureStorage, scope, entry)));
    // A missing or corrupt payload loses that job only. Emptying the queue
    // would let one damaged keychain item cost the whole shift's tickets.
    return expirePrintJobs({
      jobs: jobs.filter((job): job is PrintJob => job !== null),
      printedIds: index.printedIds,
    }, now);
  } catch {
    return empty;
  }
}

async function previousEntries(
  indexStorage: PrintStorage,
  scope: PrintScope,
): Promise<IndexEntry[]> {
  try {
    return parseIndex(await indexStorage.getItem(indexKey(scope)))?.entries ?? [];
  } catch {
    return [];
  }
}

async function deleteEntry(
  secureStorage: PrintSecureStorage,
  scope: PrintScope,
  entry: IndexEntry,
): Promise<void> {
  await Promise.all(Array.from({ length: entry.chunks }, (_value, index) =>
    secureStorage.deleteItemAsync(chunkKey(scope, entry.orderId, index))));
}

/**
 * Writes payloads, commits the index, then deletes what the index no longer
 * names. A crash between the first and second step leaves orphan chunks that
 * the next save reclaims; the reverse order would leave the index promising a
 * ticket that is not there.
 */
export async function savePrintOutbox(
  indexStorage: PrintStorage,
  secureStorage: PrintSecureStorage,
  scope: PrintScope,
  outbox: PrintOutbox,
  now: number = Date.now(),
): Promise<boolean> {
  if (!safeScope(scope)) return false;
  try {
    const live = expirePrintJobs(outbox, now);
    if (live.jobs.some((job) => !printJobFits(job))) return false;
    const previous = await previousEntries(indexStorage, scope);
    const entries: IndexEntry[] = [];
    for (const job of live.jobs) {
      if (!SAFE_SEGMENT.test(job.order.id)) return false;
      const chunks = chunkByUtf8Bytes(printJobPayload(job), SECURE_CHUNK_BYTES);
      await Promise.all(chunks.map((chunk, index) =>
        secureStorage.setItemAsync(chunkKey(scope, job.order.id, index), chunk)));
      entries.push({ id: job.id, orderId: job.order.id, chunks: chunks.length });
    }
    const key = indexKey(scope);
    if (entries.length === 0 && live.printedIds.length === 0) await indexStorage.removeItem(key);
    else {
      await indexStorage.setItem(key, JSON.stringify({
        version: INDEX_VERSION, entries, printedIds: live.printedIds.slice(-MAX_PRINTED_IDS),
      }));
    }
    // Only the chunks the new index no longer names. A job that shrank keeps
    // the chunks it still uses; deleting from zero would erase the ticket that
    // was just committed.
    const retained = new Map(entries.map((entry) => [entry.orderId, entry.chunks]));
    await Promise.all(previous.flatMap((entry) => {
      const kept = retained.get(entry.orderId) ?? 0;
      return Array.from({ length: Math.max(0, entry.chunks - kept) }, (_value, offset) =>
        secureStorage.deleteItemAsync(chunkKey(scope, entry.orderId, kept + offset)));
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Erases queued tickets and their dedupe markers.
 *
 * With a `brandId` this is the tenant-switch purge the location-only key used
 * to defeat; with none it is the sign-out wipe, which must leave no guest's
 * order on a shared tablet for the next person to sign in.
 */
export async function wipePrintOutboxes(
  indexStorage: PrintIndexStorage,
  secureStorage: PrintSecureStorage,
  brandId?: string,
): Promise<boolean> {
  try {
    const prefix = brandId ? `${INDEX_PREFIX}:${brandId}:` : `${INDEX_PREFIX}:`;
    const keys = await indexStorage.getAllKeys();
    for (const key of keys) {
      // The v1 plaintext blob is removed on sight rather than migrated: it is
      // the disclosure being fixed, and a ticket that old is past its shift.
      if (!brandId && key.startsWith(LEGACY_INDEX_PREFIX) && !key.startsWith(`${INDEX_PREFIX}:`)) {
        await indexStorage.removeItem(key);
        continue;
      }
      if (!key.startsWith(prefix)) continue;
      const scope = scopeFromIndexKey(key);
      if (!scope) continue;
      const index = parseIndex(await indexStorage.getItem(key));
      for (const entry of index?.entries ?? []) await deleteEntry(secureStorage, scope, entry);
      await indexStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

/** Removes the pre-encryption plaintext queue for one location. */
export async function purgeLegacyPrintOutbox(
  indexStorage: PrintStorage,
  locationId: string,
): Promise<void> {
  try {
    await indexStorage.removeItem(`${LEGACY_INDEX_PREFIX}${locationId}`);
  } catch {
    // A device that cannot clear the legacy blob still gets the encrypted
    // queue; the next wipe or reinstall reclaims it.
  }
}
