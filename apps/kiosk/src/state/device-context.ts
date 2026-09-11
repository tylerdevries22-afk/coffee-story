import type { DeviceRole } from '@platform/schema';
import { createContext, useContext } from 'react';

import { postureFor, type KioskPosture } from '@/features/kiosk-mode';

/** State and capabilities derived from the tablet's paired device role. */
export type DeviceStatus = 'loading' | 'unpaired' | 'ready' | 'revoked';

export type DeviceValue = {
  status: DeviceStatus;
  role: DeviceRole;
  posture: KioskPosture;
  deviceId: string | null;
  locationId: string | null;
  brandId: string | null;
  label: string | null;
  accessToken: string | null;
  pair: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  unpair: () => Promise<void>;
};

const LOBBY_POSTURE = postureFor('kiosk');

export const UNPAIRED: Omit<DeviceValue, 'pair' | 'unpair'> = {
  status: 'unpaired',
  role: 'kiosk',
  // postureFor returns null only for roles that cannot run the kiosk binary.
  posture: LOBBY_POSTURE ?? {
    unattended: true,
    allowsCashTender: true,
    allowsOrderLookup: false,
    idleResets: true,
    channel: 'kiosk',
  },
  deviceId: null,
  locationId: null,
  brandId: null,
  label: null,
  accessToken: null,
};

export const DeviceContext = createContext<DeviceValue>({
  ...UNPAIRED,
  pair: async () => ({ ok: true }),
  unpair: async () => {},
});

export function useDevice(): DeviceValue {
  return useContext(DeviceContext);
}
