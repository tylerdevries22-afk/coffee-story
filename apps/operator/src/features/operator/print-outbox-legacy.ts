import type { PrintStorage } from './print-outbox';
import { LEGACY_INDEX_PREFIX } from './print-outbox-keys';

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
