import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import type { DeviceRole } from '@platform/schema';

import { postureFor, type KioskPosture } from '@/features/kiosk-mode';
import {
  clearDeviceToken, needsRefresh, readDeviceToken, writeDeviceToken,
  type StoredDeviceToken,
} from '@/lib/device-token';
import { pairDevice, refreshDevice } from '@/lib/pairing';

/**
 * Which station this tablet is, and what it may do.
 *
 * Posture belongs to the PAIRED DEVICE, not to the build: swapping a tablet
 * between the lobby and the counter should be a re-pair, not a re-release.
 * `postureFor` was written for exactly that in 0022's era and was fed a module
 * constant until now, so the whole `pos` branch -- cash tender, order lookup,
 * no idle reset -- has been unreachable code.
 *
 * An unpaired binary runs as an unattended lobby kiosk, which is the safer of
 * the two postures: no cash drawer, no order lookup, and the idle reset on.
 */
export type DeviceStatus = 'loading' | 'unpaired' | 'ready' | 'revoked';

type DeviceValue = {
  status: DeviceStatus;
  role: DeviceRole;
  posture: KioskPosture;
  deviceId: string | null;
  locationId: string | null;
  brandId: string | null;
  label: string | null;
  /** The bearer token for the platform API, or null when unpaired. */
  accessToken: string | null;
  pair: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  unpair: () => Promise<void>;
};

const LOBBY_POSTURE = postureFor('kiosk');

const UNPAIRED: Omit<DeviceValue, 'pair' | 'unpair'> = {
  status: 'unpaired',
  role: 'kiosk',
  // `postureFor` returns null only for roles that must never run this binary;
  // 'kiosk' is not one, so this cannot be null in practice.
  posture: LOBBY_POSTURE ?? {
    unattended: true, allowsCashTender: false, allowsOrderLookup: false,
    idleResets: true, channel: 'kiosk',
  },
  deviceId: null,
  locationId: null,
  brandId: null,
  label: null,
  accessToken: null,
};

const DeviceContext = createContext<DeviceValue>({ ...UNPAIRED, pair: async () => ({ ok: true }), unpair: async () => {} });

export function DeviceProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<Omit<DeviceValue, 'pair' | 'unpair'>>({ ...UNPAIRED, status: 'loading' });

  const adopt = useCallback((stored: StoredDeviceToken) => {
    const role = stored.role as DeviceRole;
    const posture = postureFor(role);
    if (!posture) {
      // A display or prep token has no business running this binary at all.
      setState({ ...UNPAIRED, status: 'unpaired' });
      return;
    }
    setState({
      status: 'ready',
      role,
      posture,
      deviceId: stored.deviceId,
      locationId: stored.locationId,
      brandId: stored.brandId,
      label: stored.label,
      accessToken: stored.token,
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await readDeviceToken();
      if (!alive) return;
      if (!stored) {
        setState({ ...UNPAIRED, status: 'unpaired' });
        return;
      }
      adopt(stored);
      // Refreshed on launch rather than on failure: re-reading the row is what
      // makes a revocation land, and doing it at open means a tablet revoked
      // overnight is dark before the first guest rather than at the first sale.
      if (needsRefresh(stored, Date.now())) {
        const refreshed = await refreshDevice(stored.token);
        if (!alive) return;
        if (refreshed.ok) {
          await writeDeviceToken(refreshed.token);
          adopt(refreshed.token);
        } else if (refreshed.revoked) {
          await clearDeviceToken();
          setState({ ...UNPAIRED, status: 'revoked' });
        }
        // A network failure leaves the existing token in place: a shop with a
        // flaky uplink should keep selling on a token that has not expired.
      }
    })();
    return () => { alive = false; };
  }, [adopt]);

  const value = useMemo<DeviceValue>(() => ({
    ...state,
    pair: async (code) => {
      const result = await pairDevice(code);
      if (!result.ok) return { ok: false, error: result.error };
      await writeDeviceToken(result.token);
      adopt(result.token);
      return { ok: true };
    },
    unpair: async () => {
      await clearDeviceToken();
      setState({ ...UNPAIRED, status: 'unpaired' });
    },
  }), [state, adopt]);

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceValue {
  return useContext(DeviceContext);
}
