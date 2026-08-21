/**
 * Storage keys shared by `demo-storage.ts` and both `portal-store` variants.
 *
 * Kept in their own module so the platform-split stores can import them without
 * pulling in each other or the parsers.
 */
export const APP_MODE_STORAGE_KEY = 'coffee-story.app-mode.v1';
export const LEGACY_PORTAL_STORAGE_KEY = 'coffee-story.demo-portal.v1';
export const DEMO_PORTAL_FILE_NAME = 'demo-portal.json';
/**
 * Staging file for the write-then-rename save. A leftover copy means a previous
 * save was interrupted after the data was durable but before the rename, so it
 * is preferred over a missing target during load.
 */
export const DEMO_PORTAL_TEMP_FILE_NAME = 'demo-portal.json.tmp';
