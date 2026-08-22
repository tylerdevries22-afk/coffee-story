/**
 * Row types for every table, in the shape `supabase gen types` emits.
 *
 * Hand-authored against the migrations until a live project exists to
 * generate from; regenerate with
 * `npx supabase gen types typescript --db-url "$SUPABASE_DB_URL" > src/generated.ts`
 * and reconcile. A drift test is not possible without a database, so the
 * migrations are the source of truth and this file follows them.
 */
import type { OrderStatus } from './order-status';
import type { BrandRole } from './claims';

export type FulfillmentType = 'pickup' | 'curbside' | 'catering' | 'delivery';
export type OrderChannel = 'app' | 'web' | 'kiosk' | 'pos';
export type CampaignChannel = 'push' | 'sms' | 'email';
export type DropStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type BrandRow = {
  id: string;
  slug: string;
  name: string;
  fee_bps: number;
  fee_bps_tier2: number;
  tier_threshold_cents: number;
  drops: boolean;
  catering: boolean;
  delivery: boolean;
  multi_location: boolean;
  sms: boolean;
  stored_value: boolean;
  referrals: boolean;
  brand_config: Json;
  created_at: string;
  updated_at: string;
};

export type LocationRow = {
  id: string;
  brand_id: string;
  name: string;
  address: Json;
  hours: Json;
  timezone: string;
  square_connection_id: string | null;
  ordering_paused: boolean;
  created_at: string;
  updated_at: string;
};

export type BrandUserRow = {
  id: string;
  user_id: string;
  brand_id: string;
  role: BrandRole;
  location_ids: string[];
  created_at: string;
};

export type SquareConnectionRow = {
  id: string;
  brand_id: string;
  location_id: string;
  merchant_id: string;
  square_location_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type MenuRow = {
  id: string;
  brand_id: string;
  name: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type MenuCategoryRow = {
  id: string;
  brand_id: string;
  menu_id: string;
  title: string;
  tagline: string;
  sort_order: number;
  created_at: string;
};

export type MenuItemRow = {
  id: string;
  brand_id: string;
  menu_id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string;
  image_url: string | null;
  base_price_cents: number;
  sizes: Json;
  modifiers: Json;
  availability: Json;
  is_86d: boolean;
  is_listed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DropRow = {
  id: string;
  brand_id: string;
  item_id: string;
  starts_at: string;
  ends_at: string;
  status: DropStatus;
  hero_asset_url: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerRow = {
  id: string;
  brand_id: string;
  user_id: string | null;
  phone: string | null;
  full_name: string;
  email: string | null;
  push_token: string | null;
  sms_opt_in: boolean;
  created_at: string;
  updated_at: string;
};

export type LoyaltyAccountRow = {
  id: string;
  brand_id: string;
  customer_id: string;
  points_balance: number;
  lifetime_points: number;
  created_at: string;
  updated_at: string;
};

export type LoyaltyEventRow = {
  id: string;
  brand_id: string;
  account_id: string;
  order_id: string | null;
  type: 'earn' | 'redeem' | 'adjust' | 'reverse';
  points: number;
  note: string;
  created_at: string;
};

export type StoredValueLedgerRow = {
  id: string;
  brand_id: string;
  customer_id: string;
  order_id: string | null;
  type: 'load' | 'spend' | 'refund' | 'adjust' | 'gift_received';
  amount_cents: number;
  balance_after_cents: number;
  note: string;
  created_at: string;
};

export type ReferralRow = {
  id: string;
  brand_id: string;
  referrer_customer_id: string;
  code: string;
  referred_customer_id: string | null;
  status: 'issued' | 'claimed' | 'rewarded' | 'expired';
  created_at: string;
  claimed_at: string | null;
};

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
  square_order_id: string | null;
  square_payment_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderEventRow = {
  id: string;
  brand_id: string;
  order_id: string;
  type: OrderStatus;
  snapshot: Json;
  square_event_id: string | null;
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
