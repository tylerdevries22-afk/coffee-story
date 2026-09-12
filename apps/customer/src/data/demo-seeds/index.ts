import { COFFEE_SEEDS } from './coffee';
import { CONSTRUCTION_SEEDS } from './construction';
import { NEUTRAL_SEEDS } from './neutral';
import type { DemoSeedSet } from './types';

export type { DemoOrderSeed, DemoSeedSet, IsoAt } from './types';

const SEED_SETS: Readonly<Record<string, DemoSeedSet>> = {
  construction: CONSTRUCTION_SEEDS,
  'coffee-shop': COFFEE_SEEDS,
};

/**
 * The demo seed set for an industry key, mirroring `homeIndustryPack` in
 * `screens/client/home-industry-copy.ts` exactly: three known packs, and any
 * other key -- including `generic` and one the platform has not shipped a
 * pack for yet -- resolves to neutral rather than to whichever tenant used to
 * fall through by default.
 */
export function resolveDemoSeeds(industryKey: string): DemoSeedSet {
  return SEED_SETS[industryKey] ?? NEUTRAL_SEEDS;
}
