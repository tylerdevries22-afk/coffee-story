/**
 * The brand row POST /api/orders reads before it writes anything, and the two
 * answers it needs from it: where a card order will actually be paid, and
 * which tax authorities price the cart.
 *
 * Both come off the same `brands` select, which is why they share a module
 * rather than sitting either side of the placement call: one read, one
 * failure to handle, and no order written until both have succeeded.
 */
import type { PlaceOrderRequest } from '@platform/api-client';
import { parseTaxJurisdictions, type TaxJurisdiction } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { jsonError } from './api-auth';
import { squareRuntimeFor, type BrandFeeRow, type SquareRuntime } from './square-runtime';
import { isTenantRedirect, tenantSchemeOf } from './tenant-redirect';

export type OrderTenderContext = {
  /** Null for every tender but a square_link order at a connected location. */
  square: SquareRuntime | null;
  taxJurisdictions: readonly TaxJurisdiction[];
};

export async function resolveOrderTender(
  db: SupabaseClient,
  { brandId, body }: { brandId: string; body: PlaceOrderRequest },
): Promise<OrderTenderContext | Response> {
  const brand = await db
    .from('brands')
    .select('id, brand_config, fee_bps, fee_bps_tier2, tier_threshold_cents')
    .eq('id', brandId)
    .single<{ id: string; brand_config: unknown } & BrandFeeRow>();
  if (brand.error) return jsonError(500, 'internal', 'Could not load the brand.');

  // Checked before the order is written: a card order with nowhere to pay is
  // a row the guest can never settle and the board must never show.
  let square: SquareRuntime | null = null;
  if (body.tenderType === 'square_link') {
    try {
      square = await squareRuntimeFor(db, {
        brandId,
        locationId: body.locationId,
        brand: brand.data,
      });
    } catch {
      return jsonError(500, 'internal', 'Could not read this location’s payment connection.');
    }
    if (!square) {
      return jsonError(503, 'tender_unavailable', 'Card payments are not connected for this location yet; order with pay_at_pickup.');
    }
    // Square appends the transaction ids to whatever URL it is given, on a
    // page wearing the brand's name, so the destination must be this
    // tenant's own app. Fail closed: a brand that declares no scheme takes
    // no redirect.
    if (body.redirectUrl !== undefined
      && !isTenantRedirect(body.redirectUrl, tenantSchemeOf(brand.data.brand_config))) {
      return jsonError(400, 'invalid_request', 'redirectUrl must be this app’s own deep link.');
    }
  }

  let taxJurisdictions;
  try {
    taxJurisdictions = parseTaxJurisdictions(brand.data.brand_config);
  } catch (error) {
    return jsonError(500, 'config_invalid', error instanceof Error ? error.message : 'Bad tax config.');
  }

  return { square, taxJurisdictions };
}
