/**
 * Shared order types and the OrderError every order module raises.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrderTenderType } from '@platform/schema';

import type { MenuPricingError } from '../menu-pricing';
import type { TaxJurisdiction } from '../tax';

export type { OrderTenderType };
/** `app.order_channel`. Where the order was taken, not how it was paid. */
export type OrderChannel = 'app' | 'web' | 'kiosk' | 'pos';

export class OrderError extends Error {
  readonly code:
    | 'invalid_request'
    | 'location_unknown'
    | 'ordering_paused'
    | 'idempotency_conflict'
    | 'price_changed'
    | 'item_unavailable'
    | 'refund_unavailable'
    | 'cancel_unavailable'
    | MenuPricingError['code'];

  constructor(code: OrderError['code'], message: string) {
    super(message);
    this.name = 'OrderError';
    this.code = code;
  }
}

export type CreateOrderLine = {
  itemSlug: string;
  sizeSlug?: string | null;
  quantity: number;
  modifierSlugs?: string[];
  note?: string;
  packContents?: { itemSlug: string; quantity: number }[];
};

export type CreateOrderInput = {
  brandId: string;
  locationId: string;
  customerId: string | null;
  /** The auth user behind the request, recorded on the created event. */
  actorUserId: string | null;
  fulfillmentType: 'pickup' | 'curbside' | 'catering' | 'delivery';
  scheduledFor: string | null;
  note: string;
  lines: readonly CreateOrderLine[];
  tipCents: number;
  /** Client-side ceiling already shown to the guest; never an authority on price. */
  maximumTotalCents?: number;
  tenderType: OrderTenderType;
  /**
   * Where the order came from. Derived server-side from who is calling, never
   * from the body: the column existed with `default 'app'` and nothing ever
   * wrote it, so `in_app_share` on the HQ dashboard and in the weekly owner
   * email has been pinned at 100% for every brand since the view shipped.
   */
  channel: OrderChannel;
  /**
   * A display-safe guest name for the ticket, already validated by the caller
   * with `parseGuestLabel`. Null when the guest gave none -- the column stays
   * null rather than holding an empty string, because the board renders it
   * directly.
   */
  guestLabel: string | null;
  /**
   * The paired device that took the order (0038). Null for app and web. It is
   * what narrows `orders_kiosk_select` to the device's own orders rather than
   * every order at that location in the past hour.
   */
  deviceId: string | null;
  /** Required Idempotency-Key; persisted as orders.client_key. */
  clientKey: string;
  taxJurisdictions: readonly TaxJurisdiction[];
};

export type CreateOrderResult = {
  orderId: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  /**
   * The ticket the shop calls out. Assigned by a trigger, so it comes back with
   * the row rather than being computed here -- a surface that invents its own
   * number is how a barista and a pickup board end up disagreeing.
   */
  dailyNumber: number | null;
  /** True when client_key matched an existing order and nothing was written. */
  replayed: boolean;
};

export type CreateOrderDeps = { db: SupabaseClient };
