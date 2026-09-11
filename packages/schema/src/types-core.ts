/**
 * Row types for every table, in the shape `supabase gen types` emits.
 * Hand-authored against the migrations until a live project exists to
 * generate from; regenerate with
 * `npx supabase gen types typescript --db-url "$SUPABASE_DB_URL" > src/generated.ts`
 * and reconcile. A drift test is not possible without a database, so the
 * migrations are the source of truth and this file follows them.
 */
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

/**
 * The same four roles as a value, so a form can offer them and a server can
 * check them against one list.
 *
 * It lives here rather than beside the pairing code because the console's
 * device form is a client component: importing the allowlist from the module
 * that also imports the engine would pull node crypto into a browser bundle.
 */
export const DEVICE_ROLES: readonly DeviceRole[] = ['kiosk', 'pos', 'display', 'prep'];
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
 * What brand_storefront_lookup returns (0015, narrowed 0903005237):
 * everything a guest's app needs to boot — identity, feature flags,
 * brand_config tokens/copy — and none of the platform's fee terms, which stay
 * claim-gated on brands.
 *
 * `operations` is deliberately absent. It was declared here but never
 * projected by the view, so every read of it returned undefined behind a type
 * that promised a boolean; it is a staff capability with no storefront use.
 */
export type BrandStorefrontRow = {
  id: string;
  slug: string;
  name: string;
  drops: boolean;
  catering: boolean;
  delivery: boolean;
  multi_location: boolean;
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

/**
 * A server-only, short-lived copy of a replaced Square access credential.
 * Tenant identifiers are retained without foreign keys: deleting a location
 * must not strand a previously issued token before the worker revokes it.
 */
export type SquareAccessTokenRetirementRow = {
  id: string;
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
  retire_after: string;
  created_at: string;
};
