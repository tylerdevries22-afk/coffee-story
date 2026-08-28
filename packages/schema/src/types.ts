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
/**
 * How the money settles (`orders.tender_type`, CHECK in 0012).
 *
 * Declared here because the CHECK constraint is its source of truth, and it was
 * previously declared twice -- in `packages/engine` and `packages/api-client` --
 * with nothing keeping the two in step with each other or with the SQL.
 *
 * This is NOT the same axis as the button a guest presses. A kiosk offers
 * "card" or "gift card"; those are `KioskTender` in `packages/domain` and map
 * onto these. Conflating the two is how a kiosk ends up posting a value the
 * CHECK rejects.
 */
export type OrderTenderType = 'pay_at_pickup' | 'external' | 'square_link' | 'square_card';
export type DeviceRole = 'kiosk' | 'pos' | 'display' | 'prep';
export type PrepStatus = 'pending' | 'in_progress' | 'done' | 'abandoned';
export type TaskRecurrence = 'opening' | 'closing' | 'daily' | 'weekly';
export type OperationOccurrenceStatus =
  | 'scheduled' | 'claimed' | 'completed' | 'missed' | 'cancelled';

export type OperationOccurrenceRow = {
  id: string;
  brand_id: string;
  location_id: string;
  schedule_id: string | null;
  template_id: string;
  source: 'schedule' | 'manual' | 'event';
  materialization_key: string;
  template_snapshot: Record<string, unknown>;
  scheduled_for: string;
  due_at: string;
  grace_minutes: number;
  status: OperationOccurrenceStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  completed_at: string | null;
  completion_note: string;
  created_at: string;
  updated_at: string;
};
export type ItemRotation = 'permanent' | 'rotating' | 'day_specific';
/** What a guest may do with a drop right now (app.drop_visibility). */
export type DropVisibility = 'hidden' | 'revealed' | 'orderable' | 'ended';
export type CampaignChannel = 'push' | 'sms' | 'email';
export type DropStatus = 'draft' | 'scheduled' | 'revealed' | 'live' | 'ended' | 'cancelled';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/**
 * The world-readable brand_storefront view (0015): everything a guest's app
 * needs to boot — identity, feature flags, brand_config tokens/copy — and
 * none of the platform's fee terms, which stay claim-gated on brands.
 */
export type BrandStorefrontRow = {
  id: string;
  slug: string;
  name: string;
  drops: boolean;
  catering: boolean;
  delivery: boolean;
  multi_location: boolean;
  operations: boolean;
  sms: boolean;
  stored_value: boolean;
  referrals: boolean;
  brand_config: Json;
};

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
  operations: boolean;
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
  /**
   * Per-location overrides of rule 3's brand fee terms (0039). NULL inherits.
   * Readable by the service role only -- 0040 revokes these columns from the
   * client roles, because `locations_select` is `using (true)` and a
   * franchise platform must not publish what each franchisee pays.
   */
  fee_bps: number | null;
  fee_bps_tier2: number | null;
  tier_threshold_cents: number | null;
  created_at: string;
  updated_at: string;
};

export type BrandUserRow = {
  id: string;
  user_id: string;
  brand_id: string;
  role: BrandRole;
  location_ids: string[];
  display_name: string;
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
  rotation: ItemRotation;
  /** ISO weekday, 1 = Monday. Non-null exactly when rotation is day_specific. */
  weekday: number | null;
  /** Null means this is not a pack. */
  pack_size: number | null;
  choice_source: 'lineup' | 'static' | null;
  single_item_id: string | null;
  /** Stable slugs authored for this pack; availability narrows this set. */
  pack_choice_slugs: string[];
  created_at: string;
  updated_at: string;
};

export type DropRow = {
  id: string;
  brand_id: string;
  item_id: string;
  /** Visible as a teaser from here; null = no separate reveal. */
  reveal_at: string | null;
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

export type DeviceRow = {
  id: string;
  brand_id: string;
  location_id: string;
  role: DeviceRole;
  label: string;
  /** HMAC of the pairing code (0038). The code itself is never stored. */
  pairing_code_hash: string | null;
  pairing_expires_at: string | null;
  /** Bumped on revoke and re-pair; compared on every API request (0038). */
  token_version: number;
  paired_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RecipeRow = {
  id: string;
  brand_id: string;
  menu_item_id: string;
  version: number;
  /** [{ n, text, minutes? }] -- steps carry their own timing. */
  steps: Json;
  yield_qty: number;
  yield_unit: string;
  allergens: string[];
  notes: string;
  active_from: string;
  created_at: string;
  updated_at: string;
};

export type PrepBatchRow = {
  id: string;
  brand_id: string;
  location_id: string;
  recipe_id: string;
  service_date: string;
  target_qty: number;
  produced_qty: number;
  status: PrepStatus;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftRow = {
  id: string;
  brand_id: string;
  location_id: string;
  brand_user_id: string;
  starts_at: string;
  ends_at: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export type CrewTaskRow = {
  id: string;
  brand_id: string;
  location_id: string | null;
  title: string;
  detail: string;
  recurrence: TaskRecurrence;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CrewTaskCompletionRow = {
  id: string;
  brand_id: string;
  location_id: string;
  task_id: string;
  service_date: string;
  completed_by: string | null;
  completed_at: string;
};

/**
 * The columns of `locations` a client role may read (0040).
 *
 * `locations_select` is `using (true)` because a shop's address and hours are
 * storefront data, and RLS cannot hide a column -- so the fee terms 0039 added
 * are revoked at column level instead. A client asking for `*` gets an error,
 * not a redacted row, which is why this type exists: it is the column list, so
 * the type and the grant cannot drift.
 */
export type LocationStorefrontRow = Omit<
  LocationRow,
  'fee_bps' | 'fee_bps_tier2' | 'tier_threshold_cents' | 'square_connection_id'
>;

/** The storefront columns, as a select list PostgREST accepts. */
export const LOCATION_STOREFRONT_COLUMNS =
  'id, brand_id, name, address, hours, timezone, ordering_paused, created_at, updated_at';

/**
 * public.loyalty_standing -- annual and lifetime, named separately (0035).
 *
 * Two different promises. `annual_points` is the trailing twelve months and
 * can fall; it sets the earn rate, which is an entitlement. `lifetime_points`
 * only ever rises; it sets the in-store badge, which is recognition. Neither
 * is derivable from the other, which is why both are here.
 */
export type LoyaltyStandingRow = {
  customer_id: string;
  brand_id: string;
  points_balance: number;
  lifetime_points: number;
  annual_points: number;
};

/**
 * public.board_tickets -- the pickup display's PII-narrow projection.
 *
 * Every field here is readable by a whole room, so the list is a privacy
 * decision before it is a type. `loyalty_tier` is a coarse bucket slug and
 * never a balance; there is deliberately no customer_id to join one back to.
 */
export type BoardTicketRow = {
  id: string;
  brand_id: string;
  location_id: string;
  daily_number: number | null;
  guest_label: string | null;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  /** Where the order came in from, so the board can say "via kiosk" (0030). */
  channel: OrderChannel;
  arrived_at: string | null;
  /** The brand's tier slug, or null: no account, or the brand kept it private. */
  loyalty_tier: string | null;
  updated_at: string;
};
