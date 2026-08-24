import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import type { DeviceRole } from '@platform/schema';

import { postureFor, type KioskPosture } from '@/features/kiosk-mode';

/**
 * Which station this tablet is.
 *
 * Posture belongs to the paired device, not to the build: swapping a tablet
 * between the lobby and the counter should be a re-pair, not a re-release.
 * `postureFor` was written for exactly that and has been fed a module constant
 * ever since, so this provider is where the constant finally becomes a
 * lookup.
 *
 * The token itself is not here yet -- nothing mints one (see the pairing work).
 * Until it does, an unpaired binary runs as an unattended lobby kiosk, which is
 * the safest of the two postures: no cash drawer, no order lookup, and the
 * idle reset on.
 */
export type DeviceStatus = 'unpaired' | 'ready' | 'revoked';

type DeviceValue = {
  status: DeviceStatus;
  role: DeviceRole;
  posture: KioskPosture;
  deviceId: string | null;
  locationId: string | null;
};

const UNPAIRED: DeviceValue = {
  status: 'unpaired',
  role: 'kiosk',
  // Non-null assertion is safe for a literal 'kiosk'; postureFor only returns
  // null for the roles that must never run this binary at all.
  posture: postureFor('kiosk')!,
  deviceId: null,
  locationId: null,
};

const DeviceContext = createContext<DeviceValue>(UNPAIRED);

export function DeviceProvider({ children }: PropsWithChildren) {
  const value = useMemo<DeviceValue>(() => UNPAIRED, []);
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceValue {
  return useContext(DeviceContext);
}
