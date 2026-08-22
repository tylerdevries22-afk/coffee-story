/**
 * @platform/links — deep-link parsing shared by both Expo apps.
 *
 * Framework-free by design: no React, no react-native, no Expo. These modules
 * used to exist as byte-identical copies in `apps/customer/src` and
 * `apps/operator/src`, each pinning the literal scheme `coffeestory://` — so
 * the staff app, which registers `coffee-operator`, silently rejected its own
 * deep links, and so would every tenant after the first. One copy, and no
 * literal scheme anywhere in it.
 */
export { isOwnAppScheme, isOwnAppUrl, schemeOf } from './scheme';
export { recoveryCodeFromUrl, recoveryRedirectUrl } from './auth-links';
export {
  destinationForIntentUrl,
  giftTokenFromUrl,
  type IntentDestination,
} from './intent-links';
export { redirectSystemPath } from './native-intent';
