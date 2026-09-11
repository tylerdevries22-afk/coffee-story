import {
  useCallback, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import type { DeviceRole } from '@platform/schema';

import { postureFor } from '@/features/kiosk-mode';
import {
  captureCredentialOperation, isCredentialOperationCurrent, nextCredentialGeneration,
  type CredentialOperation,
} from '@/lib/device-credential';
import {
  clearDeviceToken, isExpired, needsRefresh, readDeviceToken, writeDeviceToken,
  type StoredDeviceToken,
} from '@/lib/device-token';
import { pairDevice, refreshDevice } from '@/lib/pairing';
import { DeviceContext, UNPAIRED, type DeviceValue } from '@/state/device-context';
import { useDeviceRefresh } from '@/state/use-device-refresh';
import { TENANT } from '@/tenant';

const TENANT_SLUG = TENANT.identity.slug;

export { useDevice, type DeviceStatus } from '@/state/device-context';

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

  useDeviceRefresh({
    storedToken, retryNotBefore, tenantSlug: TENANT_SLUG, credentialGeneration,
    isCurrent, persistRefresh, adopt, revoke, setRetryNotBefore,
  });

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
