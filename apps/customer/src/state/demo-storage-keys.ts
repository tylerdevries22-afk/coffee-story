/**
 * Storage keys shared by `demo-storage.ts` and both `portal-store` variants.
 *
 * Kept in their own module so the platform-split stores can import them without
 * pulling in each other or the parsers.
 */
// Namespaced to the platform and the app, matching apps/operator. These were
// prefixed with the first tenant's slug, so every brand's binary stored its
// demo state under one shop's name. An installed app loses whichever mode it
// had recorded and starts from the default, which is what a fresh install does.
export const APP_MODE_STORAGE_KEY = 'platform.customer.app-mode.v1';
export const LEGACY_PORTAL_STORAGE_KEY = 'platform.customer.demo-portal.v1';
export const DEMO_PORTAL_FILE_NAME = 'demo-portal.json';
/**
 * Staging file for the write-then-rename save. A leftover copy means a previous
 * save was interrupted after the data was durable but before the rename, so it
 * is preferred over a missing target during load.
 */
export const DEMO_PORTAL_TEMP_FILE_NAME = 'demo-portal.json.tmp';
