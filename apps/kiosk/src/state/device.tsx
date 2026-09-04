import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import type { DeviceRole } from '@platform/schema';

import { postureFor, type KioskPosture } from '@/features/kiosk-mode';
import {
  captureCredentialOperation, isCredentialOperationCurrent, nextCredentialGeneration,
  type CredentialOperation,
} from '@/lib/device-credential';
import {
  clearDeviceToken, isExpired, needsRefresh, readDeviceToken, writeDeviceToken,
  type StoredDeviceToken,
} from '@/lib/device-token';
import { pairDevice, refreshDevice } from '@/lib/pairing';
import { TENANT } from '@/tenant';

const TENANT_SLUG = TENANT.identity.slug;

/**
 * Which station this tablet is, and what it may do.
 *
 * Posture belongs to the PAIRED DEVICE, not to the build: swapping a tablet
 * between the lobby and the counter should be a re-pair, not a re-release.
 * `postureFor` was written for exactly that in 0022's era and was fed a module
 * constant until now, so the whole `pos` branch -- cash tender, order lookup,
 * no idle reset -- has been unreachable code.
 *
 * An unpaired binary runs as an unattended lobby kiosk: pay-at-counter is
 * staff-collected, while order lookup remains private and idle reset stays on.
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
    unattended: true, allowsCashTender: true, allowsOrderLookup: false,
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
  const [storedToken, setStoredToken] = useState<StoredDeviceToken | null>(null);
  const [retryNotBefore, setRetryNotBefore] = useState(0);
  const credentialGeneration = useRef(0);
  const activeToken = useRef<string | null>(null);
  const credentialMutationQueue = useRef<Promise<void>>(Promise.resolve());

  const invalidateCredential = useCallback(() => {
    credentialGeneration.current = nextCredentialGeneration(credentialGeneration.current);
    return credentialGeneration.current;
  }, []);

  const isCurrent = useCallback((operation: CredentialOperation) => (
    isCredentialOperationCurrent(operation, credentialGeneration.current, activeToken.current)
  ), []);

  const queueCredentialMutation = useCallback((mutation: () => Promise<boolean>): Promise<boolean> => {
    const result = credentialMutationQueue.current.then(mutation);
    credentialMutationQueue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const persistRefresh = useCallback((operation: CredentialOperation, refreshed: StoredDeviceToken) => (
    queueCredentialMutation(async () => {
      if (!isCurrent(operation)) return false;
      await writeDeviceToken(refreshed);
      return isCurrent(operation);
    })
  ), [isCurrent, queueCredentialMutation]);

  const revoke = useCallback(async (operation: CredentialOperation) => {
    if (!isCurrent(operation)) return;
    const revokedGeneration = invalidateCredential();
    activeToken.current = null;
    setStoredToken(null);
    setRetryNotBefore(0);
    setState({ ...UNPAIRED, status: 'revoked' });
    await queueCredentialMutation(async () => {
      await clearDeviceToken();
      return credentialGeneration.current === revokedGeneration;
    });
  }, [invalidateCredential, isCurrent, queueCredentialMutation]);

  const adopt = useCallback((stored: StoredDeviceToken) => {
    if (stored.tenantSlug !== TENANT_SLUG) {
      credentialGeneration.current = nextCredentialGeneration(credentialGeneration.current);
      activeToken.current = null;
      setState({ ...UNPAIRED, status: 'unpaired' });
      setStoredToken(null);
      return;
    }
    const role = stored.role as DeviceRole;
    const posture = postureFor(role);
    if (!posture) {
      // A display or prep token has no business running this binary at all.
      credentialGeneration.current = nextCredentialGeneration(credentialGeneration.current);
      activeToken.current = null;
      setState({ ...UNPAIRED, status: 'unpaired' });
      setStoredToken(null);
      return;
    }
    activeToken.current = stored.token;
    setStoredToken(stored);
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
      const readOperation = captureCredentialOperation(credentialGeneration.current, activeToken.current);
      const stored = await readDeviceToken();
      if (!alive || !isCurrent(readOperation)) return;
      if (!stored) {
        activeToken.current = null;
        setState({ ...UNPAIRED, status: 'unpaired' });
        return;
      }
      if (stored.tenantSlug !== TENANT_SLUG) {
        invalidateCredential();
        activeToken.current = null;
        await queueCredentialMutation(async () => {
          await clearDeviceToken();
          return true;
        });
        if (alive) setState({ ...UNPAIRED, status: 'unpaired' });
        return;
      }
      activeToken.current = stored.token;
      const refreshOperation = captureCredentialOperation(credentialGeneration.current, stored.token);
      // Refreshed on launch rather than on failure: re-reading the row is what
      // makes a revocation land, and doing it at open means a tablet revoked
      // overnight is dark before the first guest rather than at the first sale.
      if (needsRefresh(stored, Date.now())) {
        const refreshed = await refreshDevice(stored.token, TENANT_SLUG);
        if (!alive || !isCurrent(refreshOperation)) return;
        if (refreshed.ok) {
          const persisted = await persistRefresh(refreshOperation, refreshed.token);
          if (!alive || !persisted || !isCurrent(refreshOperation)) return;
          adopt(refreshed.token);
        } else if (refreshed.revoked) {
          await revoke(refreshOperation);
        } else if (isExpired(stored, Date.now())) {
          // An expired bearer is not an offline mode. Selling under it would
          // fall through to the demo checkout and display a payment success
          // for an order the shop never received.
          await revoke(refreshOperation);
        } else {
          if (!isCurrent(refreshOperation)) return;
          adopt(stored);
          setRetryNotBefore(Date.now() + 60_000);
        }
        // A network failure leaves the existing token in place: a shop with a
        // flaky uplink should keep selling on a token that has not expired.
      } else {
        adopt(stored);
      }
    })();
    return () => { alive = false; };
  }, [adopt, invalidateCredential, isCurrent, persistRefresh, queueCredentialMutation, revoke]);

  useEffect(() => {
    if (!storedToken) return;
    let alive = true;
    const expiresAt = Date.parse(storedToken.expiresAt);
    const refreshAt = Math.max(Date.now() + 1_000, expiresAt - 60 * 60 * 1000, retryNotBefore);
    const operation = captureCredentialOperation(credentialGeneration.current, storedToken.token);
    const timer = setTimeout(() => {
      void (async () => {
        const refreshed = await refreshDevice(storedToken.token, TENANT_SLUG);
        if (!alive || !isCurrent(operation)) return;
        if (refreshed.ok) {
          const persisted = await persistRefresh(operation, refreshed.token);
          if (!alive || !persisted || !isCurrent(operation)) return;
          setRetryNotBefore(0);
          adopt(refreshed.token);
          return;
        }
        if (refreshed.revoked || isExpired(storedToken, Date.now())) {
          await revoke(operation);
          return;
        }
        // Stay on the still-valid token and retry with a bounded cadence.
        if (isCurrent(operation)) setRetryNotBefore(Date.now() + 60_000);
      })();
    }, refreshAt - Date.now());
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [storedToken, retryNotBefore, adopt, isCurrent, persistRefresh, revoke]);

  const value = useMemo<DeviceValue>(() => ({
    ...state,
    pair: async (code) => {
      const operation = captureCredentialOperation(credentialGeneration.current, activeToken.current);
      const result = await pairDevice(code, TENANT_SLUG);
      if (!result.ok) return { ok: false, error: result.error };
      if (!isCurrent(operation)) return { ok: false, error: 'Pairing was cancelled.' };
      const pairedGeneration = invalidateCredential();
      const persisted = await queueCredentialMutation(async () => {
        if (credentialGeneration.current !== pairedGeneration) return false;
        await writeDeviceToken(result.token);
        return credentialGeneration.current === pairedGeneration;
      });
      if (!persisted || credentialGeneration.current !== pairedGeneration) {
        return { ok: false, error: 'Pairing was cancelled.' };
      }
      setRetryNotBefore(0);
      adopt(result.token);
      return { ok: true };
    },
    unpair: async () => {
      invalidateCredential();
      activeToken.current = null;
      setStoredToken(null);
      setRetryNotBefore(0);
      setState({ ...UNPAIRED, status: 'unpaired' });
      await queueCredentialMutation(async () => {
        await clearDeviceToken();
        return true;
      });
    },
  }), [state, adopt, invalidateCredential, isCurrent, queueCredentialMutation]);

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceValue {
  return useContext(DeviceContext);
}
