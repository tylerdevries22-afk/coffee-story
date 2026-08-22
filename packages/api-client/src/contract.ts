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
import type { FulfillmentType, OrderStatus } from '@platform/schema';

export type TenderType = 'pay_at_pickup' | 'external' | 'square_link' | 'square_card';

export type PlaceOrderLine = {
  itemSlug: string;
  /** Size slug within the item's sizes JSON, when the item has sizes. */
  sizeSlug?: string | null;
  quantity: number;
  /** Modifier choice slugs, priced server-side from the item's modifiers. */
  modifierSlugs?: string[];
  note?: string;
};

export type PlaceOrderRequest = {
  locationId: string;
  fulfillmentType: FulfillmentType;
  /** ISO pickup window start; omitted = as soon as possible. */
  scheduledFor?: string | null;
  lines: PlaceOrderLine[];
  tipCents: number;
  loyaltyRedeemPoints?: number;
  note?: string;
  tenderType: TenderType;
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
};

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

export type MintReferralResponse = {
  code: string;
};

export type HealthResponse = {
  ok: true;
  version: string;
};

/** Route table: one place the paths live. */
export const API_ROUTES = {
  orders: '/api/orders',
  loyaltyRedeem: '/api/loyalty/redeem',
  pushTokens: '/api/push-tokens',
  profile: '/api/profile',
  referrals: '/api/referrals',
  health: '/api/health',
} as const;
