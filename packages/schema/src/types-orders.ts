import type { OrderStatus } from './order-status';
import type { CampaignChannel, CampaignStatus, FulfillmentType, Json, OrderChannel, OrderTenderType } from './types-core';

export type OrderRow = {
  id: string;
  brand_id: string;
  location_id: string;
  customer_id: string | null;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  channel: OrderChannel;
  scheduled_for: string | null;
  totals: Json;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  loyalty_redeemed_points: number;
  stored_value_applied_cents: number;
  note: string;
  /** Service date in the location's timezone; ticket numbers reset on it. */
  service_date: string | null;
  daily_number: number | null;
  /** Display-safe name for a pickup board. Never the full record. */
  guest_label: string | null;
  /** Curbside check-in. Not a status: an order can arrive mid-preparation. */
  arrived_at: string | null;
  client_key: string | null;
  tender_type: OrderTenderType;
  square_checkout_url: string | null;
  square_payment_link_id: string | null;
  square_order_id: string | null;
  square_payment_id: string | null;
  created_at: string;
  updated_at: string;
  /** Which paired device took the order (0038). Null for app and web. */
  device_id: string | null;
};

export type OrderEventRow = {
  id: string;
  brand_id: string;
  order_id: string;
  type: OrderStatus;
  snapshot: Json;
  square_event_id: string | null;
  /** Stable Square refund id; event ids only identify deliveries. */
  square_refund_id: string | null;
  /** Positive processor-refund amount, typed outside the general snapshot. */
  refund_cents: number | null;
  /** Brand-scoped idempotency key for an attended refund request. */
  refund_request_key: string | null;
  actor_user_id: string | null;
  source: 'system' | 'customer' | 'operator' | 'webhook' | 'job';
  created_at: string;
};

export type PlatformFeeRow = {
  id: string;
  brand_id: string;
  location_id: string;
  order_id: string | null;
  gross_cents: number;
  fee_cents: number;
  fee_bps_applied: number;
  square_payment_id: string;
  created_at: string;
};

export type CampaignRow = {
  id: string;
  brand_id: string;
  channel: CampaignChannel;
  name: string;
  subject: string;
  body: string;
  audience: Json;
  scheduled_at: string | null;
  status: CampaignStatus;
  stats: Json;
  drop_id: string | null;
  created_at: string;
  updated_at: string;
};

/** New-row shape: server-defaulted columns become optional. */
export type InsertOf<Row extends { id: string; created_at: string }> =
  Omit<Row, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<Row, Extract<'id' | 'created_at' | 'updated_at', keyof Row>>>;
