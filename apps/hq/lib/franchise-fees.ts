import type { SupabaseClient } from '@supabase/supabase-js';

export type LocationFeeOverrides = {
  feeBps: number | null;
  feeBpsTier2: number | null;
  tierThresholdCents: number | null;
};

export type FeeTermsLocation = LocationFeeOverrides & { id: string; name: string };

export type FeeTerms = {
  brand: { feeBps: number; feeBpsTier2: number; tierThresholdCents: number };
  locations: FeeTermsLocation[];
};

export type LocationFeeDraft = LocationFeeOverrides & {
  actorId: string;
  auditCorrelationId: string;
  brandId: string;
  locationId: string;
};

export type FeeDraftResult =
  | { ok: true; draft: LocationFeeOverrides }
  | { ok: false; error: string };

function optionalInteger(value: unknown, maximum: number): number | null | undefined {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

export function parseLocationFeeOverrides(input: {
  feeBps: unknown;
  feeBpsTier2: unknown;
  tierThresholdCents: unknown;
}): FeeDraftResult {
  const feeBps = optionalInteger(input.feeBps, 10_000);
  const feeBpsTier2 = optionalInteger(input.feeBpsTier2, 10_000);
  const tierThresholdCents = optionalInteger(input.tierThresholdCents, Number.MAX_SAFE_INTEGER);
  if (feeBps === undefined || feeBpsTier2 === undefined || tierThresholdCents === undefined) {
    return { ok: false, error: 'Rates must be whole basis points from 0–10,000 and the threshold must be non-negative cents.' };
  }
  return { ok: true, draft: { feeBps, feeBpsTier2, tierThresholdCents } };
}

/** Service-only RPC whose database boundary verifies actor, tenant, and row. */
export async function updateLocationFeeOverrides(
  db: SupabaseClient,
  draft: LocationFeeDraft,
): Promise<boolean> {
  const result = await db.rpc('set_platform_location_fee_overrides', {
    p_actor_id: draft.actorId,
    p_brand_id: draft.brandId,
    p_correlation_id: draft.auditCorrelationId,
    p_fee_bps: draft.feeBps,
    p_fee_bps_tier2: draft.feeBpsTier2,
    p_location_id: draft.locationId,
    p_tier_threshold_cents: draft.tierThresholdCents,
  });
  return !result.error && result.data === draft.locationId;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Read private commercial terms through a service-only, actor-checked RPC. */
export async function readPlatformFeeTerms(
  db: SupabaseClient,
  actorId: string,
  brandId: string,
): Promise<FeeTerms | null> {
  const result = await db.rpc('get_platform_fee_terms', {
    p_actor_id: actorId,
    p_brand_id: brandId,
  });
  if (result.error || !result.data || typeof result.data !== 'object') return null;
  const data = result.data as { brand?: unknown; locations?: unknown };
  if (!data.brand || typeof data.brand !== 'object' || !Array.isArray(data.locations)) return null;
  const brand = data.brand as Record<string, unknown>;
  if (![brand.feeBps, brand.feeBpsTier2, brand.tierThresholdCents].every(isInteger)) return null;
  const locations: FeeTermsLocation[] = [];
  for (const raw of data.locations) {
    if (!raw || typeof raw !== 'object') return null;
    const location = raw as Record<string, unknown>;
    if (typeof location.id !== 'string' || typeof location.name !== 'string') return null;
    const terms = [location.feeBps, location.feeBpsTier2, location.tierThresholdCents];
    if (!terms.every((value) => value === null || isInteger(value))) return null;
    locations.push({
      feeBps: location.feeBps as number | null,
      feeBpsTier2: location.feeBpsTier2 as number | null,
      id: location.id,
      name: location.name,
      tierThresholdCents: location.tierThresholdCents as number | null,
    });
  }
  return {
    brand: {
      feeBps: brand.feeBps as number,
      feeBpsTier2: brand.feeBpsTier2 as number,
      tierThresholdCents: brand.tierThresholdCents as number,
    },
    locations,
  };
}
