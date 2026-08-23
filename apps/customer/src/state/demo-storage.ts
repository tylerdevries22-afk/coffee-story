import type { PortalBundle } from '@platform/domain';
import { createInitialDemoPortal, migrateDemoPortalState } from '@/state/demo-state';

import {
  APP_MODE_STORAGE_KEY,
  DEMO_PORTAL_FILE_NAME,
  DEMO_PORTAL_TEMP_FILE_NAME,
  LEGACY_PORTAL_STORAGE_KEY,
} from './demo-storage-keys';
import {
  clearLegacyPortal,
  readAppMode,
  readLegacyPortalText,
  readPortalText,
  writeAppMode,
  writePortalText,
} from './portal-store';

type UnknownRecord = Record<string, unknown>;

const ROLES = ['client', 'staff', 'admin'] as const;
const ORDER_STATUSES = ['created', 'paid', 'in_progress', 'ready', 'picked_up', 'cancelled', 'refunded'] as const;
const FULFILLMENT_TYPES = ['pickup', 'curbside', 'catering', 'delivery'] as const;
const REWARD_ENTRY_TYPES = ['purchase', 'activity', 'redemption', 'adjustment', 'expiration'] as const;
const GIFT_CARD_STATUSES = ['created', 'funded', 'delivered', 'claimed', 'depleted', 'void'] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isOneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableDateString(value: unknown): value is string | null {
  return value === null || isDateString(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isProfile(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.fullName === 'string'
    && typeof value.email === 'string'
    && isNullableString(value.phone)
    && isNullableString(value.birthday)
    && isNullableString(value.avatarUrl);
}

function isOrderLine(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name === 'string'
    && isFiniteNumber(value.quantity)
    && isFiniteNumber(value.unitPriceCents)
    && Array.isArray(value.options)
    && value.options.every((option) => typeof option === 'string');
}

function isOrder(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const review = value.review;
  const reviewIsValid = review === undefined || (
    isRecord(review)
    && isFiniteNumber(review.rating)
    && typeof review.note === 'string'
    && isDateString(review.submittedAt)
  );
  return typeof value.id === 'string'
    && typeof value.summary === 'string'
    && Array.isArray(value.lines)
    && value.lines.every(isOrderLine)
    && isDateString(value.placedAt)
    // null is meaningful here: an asap order has no pickup window.
    && (value.scheduledFor === null || isDateString(value.scheduledFor))
    && isOneOf(value.status, ORDER_STATUSES)
    && isOneOf(value.fulfillmentType, FULFILLMENT_TYPES)
    && isFiniteNumber(value.subtotalCents)
    && isFiniteNumber(value.taxCents)
    && isFiniteNumber(value.tipCents)
    && isFiniteNumber(value.totalCents)
    && typeof value.note === 'string'
    && isOptionalString(value.guestLabel)
    && isOptionalString(value.locationLabel)
    && isOptionalString(value.locationDetail)
    && reviewIsValid;
}

function isRewardAccount(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.availablePoints)
    && isFiniteNumber(value.annualPoints)
    && isFiniteNumber(value.cashCents)
    && isDateString(value.annualPeriodStart);
}

function isRewardEntry(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && isOneOf(value.entryType, REWARD_ENTRY_TYPES)
    && isFiniteNumber(value.points)
    && typeof value.description === 'string'
    && isDateString(value.earnedAt)
    && isNullableDateString(value.expiresAt);
}

function isRewardCatalogItem(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isNullableString(value.description)
    && isFiniteNumber(value.pointsCost)
    && typeof value.active === 'boolean';
}

function isGiftCard(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.code === 'string'
    && isFiniteNumber(value.initialCents)
    && isFiniteNumber(value.balanceCents)
    && isNullableString(value.recipientEmail)
    && isNullableString(value.recipientName)
    && typeof value.designKey === 'string'
    && isNullableDateString(value.deliveryAt)
    && isOneOf(value.status, GIFT_CARD_STATUSES)
    && isDateString(value.createdAt)
    && typeof value.claimedByCurrentUser === 'boolean'
    && typeof value.purchasedByCurrentUser === 'boolean';
}

function isPaymentMethod(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.brand === 'string'
    && typeof value.last4 === 'string'
    && isFiniteNumber(value.expirationMonth)
    && isFiniteNumber(value.expirationYear)
    && typeof value.isDefault === 'boolean';
}

function isMessage(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && isOneOf(value.sender, ['client', 'studio'])
    && typeof value.body === 'string'
    && isDateString(value.sentAt)
    && typeof value.read === 'boolean';
}

function isIntake(value: unknown): boolean {
  return isRecord(value)
    && typeof value.completed === 'boolean'
    && typeof value.notes === 'string'
    && isOneOf(value.strength, ['light', 'medium', 'bold'])
    && isNullableDateString(value.updatedAt);
}

function isMembership(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isOneOf(value.status, ['active', 'paused', 'cancelled'])
    && isFiniteNumber(value.priceCents)
    && isDateString(value.renewsAt)
    && isFiniteNumber(value.creditsAvailable);
}

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

export {
  APP_MODE_STORAGE_KEY,
  DEMO_PORTAL_FILE_NAME,
  DEMO_PORTAL_TEMP_FILE_NAME,
  LEGACY_PORTAL_STORAGE_KEY,
};

/**
 * The demo portal serializes to well over the ~2 KB value limit expo-secure-store
 * guarantees on iOS (a production-scale dataset measures ~13 KB). Oversized
 * SecureStore writes fail, which silently discarded every demo-state change --
 * including resets -- and rehydrated a stale portal on the next launch. The
 * portal blob therefore lives in a document-directory file on native and in
 * localStorage on web (see `portal-store.ts` / `portal-store.web.ts`);
 * SecureStore keeps only the tiny app-mode flag it is actually suited for.
 */
export function parseStoredPortal(raw: string | null): PortalBundle | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.profile)) return null;
    const migrated = migrateDemoPortalState(parsed as PortalBundle);
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

export async function loadStoredAppMode(): Promise<string | null> {
  try {
    return await readAppMode();
  } catch {
    return null;
  }
}

export async function saveStoredAppMode(mode: 'demo' | 'live'): Promise<void> {
  await writeAppMode(mode);
}

export async function loadStoredPortal(): Promise<PortalBundle | null> {
  try {
    const parsed = parseStoredPortal(await readPortalText());
    if (parsed) return parsed;
  } catch {
    // Unreadable store -- fall through to the legacy migration below.
  }
  // One-time migration of any portal persisted via SecureStore before the portal
  // blob moved to file storage. A legacy value that cannot be read or migrated is
  // abandoned rather than blocking hydration.
  try {
    const migrated = parseStoredPortal(await readLegacyPortalText());
    if (migrated) {
      await saveStoredPortal(migrated);
      await clearLegacyPortal();
    }
    return migrated;
  } catch {
    return null;
  }
}

export async function saveStoredPortal(portal: PortalBundle): Promise<void> {
  await writePortalText(JSON.stringify(portal));
}

export async function resetStoredDemoPortal(): Promise<PortalBundle> {
  const next = createInitialDemoPortal();
  await Promise.all([
    saveStoredAppMode('demo'),
    saveStoredPortal(next),
  ]);
  return next;
}
