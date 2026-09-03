/**
 * Field-level guards for a demo portal rehydrated from on-device storage.
 *
 * Promoted verbatim from the byte-identical `demo-storage.ts` that
 * `apps/customer` and `apps/operator` each carried. Every field a screen
 * dereferences is checked, because a persisted preview file survives OTA
 * updates and a blob written by an older build otherwise hydrated and threw
 * during render -- with no error boundary and the same file reloading every
 * launch, that crash-looped with no way to reset.
 */
type UnknownRecord = Record<string, unknown>;

export const ROLES = ['client', 'staff', 'admin'] as const;
const ORDER_STATUSES = ['created', 'paid', 'in_progress', 'ready', 'picked_up', 'cancelled', 'refunded'] as const;
const FULFILLMENT_TYPES = ['pickup', 'curbside', 'catering', 'delivery'] as const;
const REWARD_ENTRY_TYPES = ['purchase', 'activity', 'redemption', 'adjustment', 'expiration'] as const;
const GIFT_CARD_STATUSES = ['created', 'funded', 'delivered', 'claimed', 'depleted', 'void'] as const;

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isOneOf(value: unknown, allowed: readonly string[]): value is string {
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

export function isProfile(value: unknown): boolean {
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

export function isOrder(value: unknown): boolean {
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
    && (value.demoSynced === undefined || typeof value.demoSynced === 'boolean')
    && (value.demoSyncSessionId === undefined || typeof value.demoSyncSessionId === 'string')
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

export function isRewardAccount(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNumber(value.availablePoints)
    && isFiniteNumber(value.annualPoints)
    && isFiniteNumber(value.cashCents)
    && isDateString(value.annualPeriodStart);
}

export function isRewardEntry(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && isOneOf(value.entryType, REWARD_ENTRY_TYPES)
    && isFiniteNumber(value.points)
    && typeof value.description === 'string'
    && isDateString(value.earnedAt)
    && isNullableDateString(value.expiresAt);
}

export function isRewardCatalogItem(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isNullableString(value.description)
    && isFiniteNumber(value.pointsCost)
    && typeof value.active === 'boolean';
}

export function isGiftCard(value: unknown): boolean {
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

export function isPaymentMethod(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.brand === 'string'
    && typeof value.last4 === 'string'
    && isFiniteNumber(value.expirationMonth)
    && isFiniteNumber(value.expirationYear)
    && typeof value.isDefault === 'boolean';
}

export function isMessage(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && isOneOf(value.sender, ['client', 'studio'])
    && typeof value.body === 'string'
    && isDateString(value.sentAt)
    && typeof value.read === 'boolean';
}

export function isIntake(value: unknown): boolean {
  return isRecord(value)
    && typeof value.completed === 'boolean'
    && typeof value.notes === 'string'
    && isOneOf(value.strength, ['light', 'medium', 'bold'])
    && isNullableDateString(value.updatedAt);
}

export function isMembership(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isOneOf(value.status, ['active', 'paused', 'cancelled'])
    && isFiniteNumber(value.priceCents)
    && isDateString(value.renewsAt)
    && isFiniteNumber(value.creditsAvailable);
}
