/**
 * Whether the brand may be asked for this kind of fulfillment at all.
 *
 * Catering and delivery are capabilities a tenant installs, but the
 * fulfillment type arrives in the request body and nothing on the write path
 * ever asked whether the brand holds one: the HQ route validated the string
 * against the four allowed values, the engine handed it to commit_order, and
 * commit_order inserted it. The only check was in the clients, which is no
 * check -- any caller with a token could book a catering or delivery order
 * against a brand that never bought either, and the shop found out when the
 * ticket printed.
 *
 * Resolved from `module_installations`, the authorization root since
 * 20260903170000, and never from the retired `brands.catering` /
 * `brands.delivery` columns -- those are being dropped, and a guard reading a
 * dropped column silently stops guarding.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { OrderError, type CreateOrderInput } from './types';

type FulfillmentType = CreateOrderInput['fulfillmentType'];

/**
 * The module that grants each fulfillment type, or null where the type is
 * baseline ordering and needs no installation.
 *
 * Keyed over the whole union rather than only the gated pair, so a fifth
 * fulfillment type fails to compile here instead of shipping ungated. The two
 * keys mirror LEGACY_FLAG_MODULE_MAP in `@platform/module-kit`; they are
 * repeated rather than imported because the engine does not depend on
 * module-kit and a capability guard is not worth a new package edge.
 */
const FULFILLMENT_MODULE: Record<FulfillmentType, { key: string; label: string } | null> = {
  pickup: null,
  curbside: null,
  catering: { key: 'commerce-catering', label: 'Catering' },
  delivery: { key: 'commerce-delivery', label: 'Delivery' },
};

/**
 * Throws unless the brand holds the module this fulfillment type needs.
 *
 * Pickup and curbside return before touching the database, so the common order
 * pays nothing for a gate that cannot apply to it.
 */
export async function requireFulfillmentCapability(
  db: SupabaseClient,
  brandId: string,
  fulfillmentType: FulfillmentType,
): Promise<void> {
  const required = FULFILLMENT_MODULE[fulfillmentType];
  if (required === null) return;

  const installed = await db
    .from('module_installations')
    .select('module_key')
    .eq('brand_id', brandId)
    .eq('module_key', required.key)
    .eq('state', 'active')
    .maybeSingle<{ module_key: string }>();
  // A read that failed is not a grant. It raises, the same as every other
  // failed read on this path, rather than resolving to "no installation" --
  // that would turn a transient outage into a wrong but plausible refusal, and
  // the inverse mistake would turn it into a grant.
  if (installed.error) throw installed.error;
  if (!installed.data) {
    throw new OrderError('fulfillment_unavailable',
      `${required.label} is not available from this brand.`);
  }
}
