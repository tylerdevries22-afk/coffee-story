import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { currentSession } from './auth';
import { selectedLocationId, selectedOrgId } from './workspace-location';

export type LiveScope = {
  orgId: string | null;
  locationId: string | null;
  locationIds: readonly string[];
};

/** Resolve the remembered workspace against the authenticated user's RLS. */
export async function liveScope(client: SupabaseClient): Promise<LiveScope> {
  const session = await currentSession();
  if (!session) return { orgId: null, locationId: null, locationIds: [] };

  const requestedOrg = await selectedOrgId();
  const candidate = requestedOrg ?? session.brandId;
  const brand = await client.from('brands').select('id').eq('id', candidate).maybeSingle<{ id: string }>();
  const orgId = brand.data?.id ?? (requestedOrg ? session.brandId : null);
  if (!orgId) return { orgId: null, locationId: null, locationIds: [] };

  const locations = await client.from('locations').select('id').eq('brand_id', orgId).returns<{ id: string }[]>();
  if (locations.error) throw new Error(`locations: ${locations.error.message}`);
  const locationIds = (locations.data ?? []).map((row) => row.id);
  const rememberedLocation = await selectedLocationId();
  const locationId = rememberedLocation && locationIds.includes(rememberedLocation)
    ? rememberedLocation
    : null;
  return { orgId, locationId, locationIds };
}
