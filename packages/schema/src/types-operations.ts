import type { OrderStatus } from './order-status';
import type { DeviceRole, FulfillmentType, Json, LocationRow, OrderChannel, PrepStatus, TaskRecurrence } from './types-core';

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
