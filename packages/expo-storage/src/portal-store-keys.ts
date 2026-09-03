/**
 * Names for the demo portal's on-device slots.
 *
 * The two file names are identical in every app, so they live here. The
 * SecureStore keys are not -- each app namespaces its own -- so the app injects
 * those and nothing here can read another app's app-mode flag by accident.
 */
export type PortalStoreKeys = {
  /** SecureStore key for the tiny demo/live flag. */
  appModeKey: string;
  /** SecureStore key holding a portal written before the blob moved to a file. */
  legacyPortalKey: string;
};

export const DEMO_PORTAL_FILE_NAME = 'demo-portal.json';

/**
 * Staging file for the write-then-rename save. A leftover copy means a previous
 * save was interrupted after the data was durable but before the rename, so it
 * is preferred over a missing target during load.
 */
export const DEMO_PORTAL_TEMP_FILE_NAME = 'demo-portal.json.tmp';
