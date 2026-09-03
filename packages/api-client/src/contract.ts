/**
 * The platform API's wire contract — the ONE definition both sides import.
 * The apps call these shapes through ApiClient; the HQ route handlers type
 * their request parsing and responses against the same names, so the two
 * ends cannot drift apart silently.
 *
 * Money is integer cents throughout (CLAUDE.md rule). Every write carries an
 * Idempotency-Key header; POST /orders additionally persists it as
 * orders.client_key so a retry returns the same order.
 */
import type { FulfillmentType, OrderChannel, OrderStatus, OrderTenderType } from '@platform/schema';

/** The wire name for `@platform/schema`'s `OrderTenderType`; one definition. */
export type TenderType = OrderTenderType;

export type PlaceOrderLine = {
  itemSlug: string;
  /** Size slug within the item's sizes JSON, when the item has sizes. */
  sizeSlug?: string | null;
  quantity: number;
  /** Modifier choice slugs, priced server-side from the item's modifiers. */
  modifierSlugs?: string[];
  note?: string;
  /** Exact contents for one pack unit. The server validates slugs and count. */
  packContents?: { itemSlug: string; quantity: number }[];
};

export type PlaceOrderRequest = {
  locationId: string;
  fulfillmentType: FulfillmentType;
  /** ISO pickup window start; omitted = as soon as possible. */
  scheduledFor?: string | null;
  lines: PlaceOrderLine[];
  tipCents: number;
  /** The most the guest approved; the server rejects a higher repriced total. */
  maximumTotalCents?: number;
  loyaltyRedeemPoints?: number;
  note?: string;
  tenderType: TenderType;
  /**
   * A display-safe name for the ticket ("Sara D."), written to
   * `orders.guest_label`. Validated server-side with `parseGuestLabel` from
   * `@platform/domain` -- the pickup board is granted to `anon` and hangs
   * where a whole room can read it, so this field is a broadcast channel.
   */
  guestLabel?: string;
  /**
   * square_link only: where Square returns the guest after paying — the app's
   * own deep link back to the order. Ignored for every other tender.
   */
  redirectUrl?: string;
};

export type PlaceOrderResponse = {
  orderId: string;
  status: OrderStatus;
  /** Recomputed server-side; the client renders these, never its own math. */
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  /** Present when tenderType is square_link: the hosted checkout to open. */
  checkoutUrl?: string;
  /**
   * The human ticket the shop calls out, assigned by `app.assign_daily_number`
   * and restarting per location per service date. Returned because a kiosk
   * cannot print a uuid and, without this, its receipt had to invent one.
   */
  dailyNumber?: number | null;
};

/** One order shared by the explicitly local five-surface sales demo. */
export type DemoSyncOrder = {
  /** Identifies the local HQ process that owns this ephemeral order. */
  sessionId: string;
  id: string;
  shortCode: string;
  guestName: string;
  status: OrderStatus;
  placedAt: string;
  dailyNumber: number;
  updatedAt: string;
  scheduledFor: string | null;
  lines: {
    name: string;
    quantity: number;
    options: string[];
    note?: string;
    packContents?: { itemSlug: string; name: string; quantity: number }[];
  }[];
  totalCents: number;
  note: string;
  tenderType: TenderType;
  channel: OrderChannel;
  fulfillmentType: FulfillmentType;
};

export type DemoSyncSnapshot = {
  /** Changes when the local HQ broker restarts and loses its in-memory orders. */
  sessionId: string;
  revision: number;
  orders: DemoSyncOrder[];
};

/** The only demo-order fields a public pickup display is allowed to receive. */
export type DemoSyncBoardTicket = Pick<
  DemoSyncOrder,
  'channel' | 'dailyNumber' | 'fulfillmentType' | 'guestName' | 'id' | 'status' | 'updatedAt'
>;

export type DemoSyncTransitionRequest = { status: OrderStatus };

export type RedeemRewardRequest = {
  rewardSlug: string;
};

export type RedeemRewardResponse = {
  pointsBalance: number;
};

export type RegisterPushTokenRequest = {
  token: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
};

export type UpdateProfileRequest = {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  smsOptIn?: boolean;
};

export type DeleteProfileResponse = { ok: true };

export type MintReferralResponse = {
  code: string;
};

export type HealthResponse = {
  ok: true;
  version: string;
};

export type SubmitTrainingQuizRequest = {
  releaseId: string;
  /** The track's portable slug -- the same value the progress rows key on. */
  trackSlug: string;
  lessonSlug: string;
  answers: number[];
};

export type SubmitTrainingQuizResponse = {
  score: number;
  passed: boolean;
  idempotent: boolean;
};

/** Route table: one place the paths live. */
export type CancelOrderRequest = {
  orderId: string;
  reason?: string;
};

export type CancelOrderResponse = {
  orderId: string;
  status: OrderStatus;
  /** True when the order was already cancelled; the call changed nothing. */
  alreadyCancelled: boolean;
};

export type RefundOrderRequest = {
  orderId: string;
  /** Whole cents to return, or the whole order. */
  amountCents?: number | 'full';
  reason?: string;
};

export type RefundOrderResponse = {
  orderId: string;
  refundId: string;
  amountCents: number;
};

export const API_ROUTES = {
  orders: '/api/orders',
  ordersCancel: '/api/orders/cancel',
  ordersRefund: '/api/orders/refund',
  loyaltyRedeem: '/api/loyalty/redeem',
  pushTokens: '/api/push-tokens',
  profile: '/api/profile',
  referrals: '/api/referrals',
  health: '/api/health',
  trainingProgress: '/api/training/progress',
} as const;
