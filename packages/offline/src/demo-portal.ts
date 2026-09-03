import type { PortalBundle } from '@platform/domain';

import {
  ROLES,
  isGiftCard,
  isIntake,
  isMembership,
  isMessage,
  isOneOf,
  isOrder,
  isPaymentMethod,
  isProfile,
  isRecord,
  isRewardAccount,
  isRewardCatalogItem,
  isRewardEntry,
  isStringArray,
} from './demo-portal-guards';

function isStoredPortal(value: unknown): value is PortalBundle {
  if (!isRecord(value)) return false;
  if (!isOneOf(value.role, ROLES) || !isProfile(value.profile)) return false;
  if (!Array.isArray(value.orders) || !value.orders.every(isOrder)) return false;
  if (!isRewardAccount(value.rewardAccount)) return false;
  if (!Array.isArray(value.rewardLedger) || !value.rewardLedger.every(isRewardEntry)) return false;
  if (!isStringArray(value.rewardActivities)) return false;
  if (!Array.isArray(value.rewardCatalog) || !value.rewardCatalog.every(isRewardCatalogItem)) return false;
  if (!Array.isArray(value.giftCards) || !value.giftCards.every(isGiftCard)) return false;
  if (value.paymentMethods !== undefined
    && (!Array.isArray(value.paymentMethods) || !value.paymentMethods.every(isPaymentMethod))) return false;
  if (value.messages !== undefined
    && (!Array.isArray(value.messages) || !value.messages.every(isMessage))) return false;
  if (value.preferences !== undefined && !isIntake(value.preferences)) return false;
  if (value.membership !== undefined && value.membership !== null && !isMembership(value.membership)) return false;
  return value.autoPromptDismissed === undefined || typeof value.autoPromptDismissed === 'boolean';
}

/**
 * The demo portal serializes to well over the ~2 KB value limit expo-secure-store
 * guarantees on iOS (a production-scale dataset measures ~13 KB). Oversized
 * SecureStore writes fail, which silently discarded every demo-state change --
 * including resets -- and rehydrated a stale portal on the next launch. The
 * portal blob therefore lives in a document-directory file on native and in
 * localStorage on web (see `@platform/expo-storage`); SecureStore keeps only the
 * tiny app-mode flag it is actually suited for.
 *
 * The migration is a parameter rather than an import because each app seeds its
 * own preview data -- the two copies of this parser differed in nothing else.
 */
export function parseStoredPortal(
  raw: string | null,
  migrate: (portal: PortalBundle) => PortalBundle,
): PortalBundle | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.profile)) return null;
    const migrated = migrate(parsed as PortalBundle);
    // Persisted preview files survive OTA updates. Validate every field that a
    // screen dereferences before hydration so a truncated or obsolete blob can
    // never strand the app inside the error boundary. Known historical reward
    // names are migrated above; unrecognized shapes safely re-seed the preview.
    return isStoredPortal(migrated) ? migrated : null;
  } catch {
    return null;
  }
}

export function parseStoredAppMode(
  raw: string | null,
  hasLiveConfig: boolean,
  isExpoGo = false,
): 'demo' | 'live' {
  // The /demo shell is intentionally a preview environment. Even if live
  // credentials are present in the build, we must keep startup deterministic
  // and visible in local/browser previews where optional keys may be omitted.
  // This also avoids stale persisted "live" mode from surfacing as a secure
  // setup gate before the user can intentionally switch to preview.
  const isDemoShell =
    typeof window !== 'undefined'
    && typeof window.location?.pathname === 'string'
    && window.location.pathname.startsWith('/demo');
  if (isDemoShell) {
    return 'demo';
  }

  // Nothing stored yet: follow the build. A build that can actually run live
  // is a build meant to sign people in, so it opens on the auth screen; one
  // that cannot can only be the preview, so it opens there.
  //
  // This used to return 'demo' unconditionally, and nothing ever wrote 'live'
  // -- `chooseLive` had no call site anywhere in the app. `isAuthenticated` is
  // `isDemo || Boolean(session)`, so `app/index.tsx` never reached AuthScreen
  // and a fully configured production build still booted into fabricated data.
  //
  // Expo Go is excluded for the same reason `shouldSimulateNativeFlow`
  // excludes it: its native module set is fixed, so card payments cannot run
  // there at all. A preview channel published with the owner's Supabase
  // variables would otherwise hand every reviewer who scans the QR a sign-in
  // screen for an account they do not have. An explicit choice still wins --
  // someone who picks live in Expo Go gets live.
  if (raw !== 'live' && raw !== 'demo') return hasLiveConfig && !isExpoGo ? 'live' : 'demo';
  return raw === 'live' && !hasLiveConfig ? 'demo' : raw;
}
