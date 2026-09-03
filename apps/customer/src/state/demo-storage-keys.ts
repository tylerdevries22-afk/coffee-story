/**
 * The SecureStore keys this app owns.
 *
 * Kept in their own module because they are the only part of demo persistence
 * that differs between the apps -- everything else now lives in
 * `@platform/offline` and `@platform/expo-storage`.
 */
// Namespaced to the platform and the app, matching apps/operator. These were
// prefixed with the first tenant's slug, so every brand's binary stored its
// demo state under one shop's name. An installed app loses whichever mode it
// had recorded and starts from the default, which is what a fresh install does.
export const APP_MODE_STORAGE_KEY = 'platform.customer.app-mode.v1';
export const LEGACY_PORTAL_STORAGE_KEY = 'platform.customer.demo-portal.v1';
