/**
 * The SecureStore keys this app owns.
 *
 * Kept in their own module because they are the only part of demo persistence
 * that differs between the apps -- everything else now lives in
 * `@platform/offline` and `@platform/expo-storage`.
 */
export const APP_MODE_STORAGE_KEY = 'platform.operator.app-mode.v1';
export const LEGACY_PORTAL_STORAGE_KEY = 'platform.operator.demo-portal.v1';
