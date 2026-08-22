import { useMemo } from 'react';

import { resolveBusiness, type BusinessDetails } from '@/data/business';
import { useAuth } from '@/state/auth-context';

/**
 * The shop the signed-in staff member works at.
 *
 * One listing serves every tenant (rule 7: tenancy is by login), so this is a
 * runtime answer, not a build-time one. `loadStaffContext` already read the
 * brand row for it and the app then dropped it on the floor: every screen read
 * the bundled `BUSINESS` constant instead, which showed Coffee Story's mark,
 * phone and website to whoever was signed in.
 */
export function useBusiness(): BusinessDetails {
  const { isDemo, brandConfig, brandName, liveLocations } = useAuth();
  // The posted address belongs to the location, not the brand. A shift lead
  // sees the address of the location they are claimed to; a manager over
  // several sees the first, which is the one a single-location brand has.
  const address = liveLocations[0]?.address ?? null;
  return useMemo(
    () => resolveBusiness({ isDemo, brandConfig, brandName, address }),
    [address, brandConfig, brandName, isDemo],
  );
}
