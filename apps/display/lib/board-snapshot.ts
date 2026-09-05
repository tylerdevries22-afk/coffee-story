import type { SupabaseClient } from '@supabase/supabase-js';

import { abortRead, readWithRetry } from '@platform/data';
import {
  resolveActivityBoardConfig, resolveBoardConfig,
  type ActivityBoardConfig, type BoardConfig,
} from '@platform/domain';
import type { ActivityBoardItemRow, BoardTicketRow } from '@platform/schema';
import { resolveCopy, type BrandCopy } from '@platform/ui/copy';

import { demoBoardAt } from './demo-board';
import {
  demoActivityItems, selectedDemoBrandConfig, selectedDemoLocationName, selectedDemoTenantKind,
} from './demo-tenant';
import { displayTheme, type DisplayTheme } from './theme';

export type BoardSnapshot = {
  locationName: string;
  tickets: BoardTicketRow[];
  activityItems: ActivityBoardItemRow[];
  config: BoardConfig;
  activityConfig: ActivityBoardConfig;
  copy: BrandCopy;
  theme: DisplayTheme;
  live: boolean;
  degraded: boolean;
  unpaired: boolean;
  demoSynced: boolean;
};

export type BrandBits = { name: string; config: unknown };

export async function loadBrandBits(
  db: SupabaseClient,
  locationId: string,
): Promise<BrandBits | null> {
  const location = await readWithRetry('display location', (signal) => abortRead(db
    .from('locations')
    .select('name, brand_id')
    .eq('id', locationId), signal)
    .maybeSingle<{ name: string; brand_id: string }>());
  if (!location) return null;

  const brand = await readWithRetry('display brand', (signal) => abortRead(db
    .rpc('brand_storefront_lookup', { p_brand_id: location.brand_id }), signal)
    .maybeSingle<{ brand_config: unknown }>());
  return { name: location.name, config: brand?.brand_config ?? {} };
}

export function fixtureBoardSnapshot(
  locationId: string,
  degraded: boolean,
  demoSynced: boolean,
  tickets = demoBoardAt(Date.now(), locationId),
): BoardSnapshot {
  const brandConfig = selectedDemoBrandConfig();
  const kind = selectedDemoTenantKind();
  return {
    locationName: selectedDemoLocationName(locationId),
    tickets: kind === 'default' ? tickets : [],
    activityItems: kind === 'activity' ? demoActivityItems(Date.now(), locationId) : [],
    config: resolveBoardConfig(brandConfig),
    activityConfig: resolveActivityBoardConfig(brandConfig),
    copy: resolveCopy((brandConfig as { copy?: unknown }).copy),
    theme: displayTheme(brandConfig),
    live: false,
    degraded,
    unpaired: kind === 'neutral',
    demoSynced,
  };
}

/** A production screen with no device token must never invent guests. */
export function unpairedBoardSnapshot(): BoardSnapshot {
  return {
    locationName: '',
    tickets: [],
    activityItems: [],
    config: resolveBoardConfig(null),
    activityConfig: resolveActivityBoardConfig(null),
    copy: resolveCopy(null),
    theme: displayTheme(null),
    live: false,
    degraded: false,
    unpaired: true,
    demoSynced: false,
  };
}

export function liveBoardSnapshot(
  brand: BrandBits | null,
  tickets: BoardTicketRow[],
  activityItems: ActivityBoardItemRow[],
): BoardSnapshot {
  return {
    locationName: brand?.name ?? 'Pickup',
    tickets,
    activityItems,
    config: resolveBoardConfig(brand?.config),
    activityConfig: resolveActivityBoardConfig(brand?.config),
    copy: resolveCopy((brand?.config as { copy?: unknown } | undefined)?.copy),
    theme: displayTheme(brand?.config),
    live: true,
    degraded: false,
    unpaired: false,
    demoSynced: false,
  };
}
