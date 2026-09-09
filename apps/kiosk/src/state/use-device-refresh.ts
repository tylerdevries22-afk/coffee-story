import { useEffect } from 'react';

import { captureCredentialOperation, type CredentialOperation } from '@/lib/device-credential';
import { isExpired, type StoredDeviceToken } from '@/lib/device-token';
import { refreshDevice } from '@/lib/pairing';

type CurrentRef<T> = { readonly current: T };

type DeviceRefreshOptions = {
  storedToken: StoredDeviceToken | null;
  retryNotBefore: number;
  tenantSlug: string;
  credentialGeneration: CurrentRef<number>;
  isCurrent: (operation: CredentialOperation) => boolean;
  persistRefresh: (operation: CredentialOperation, token: StoredDeviceToken) => Promise<boolean>;
  adopt: (token: StoredDeviceToken) => void;
  revoke: (operation: CredentialOperation) => Promise<void>;
  setRetryNotBefore: (value: number) => void;
};

/** Refresh a valid paired credential before its expiry window closes. */
export function useDeviceRefresh({
  storedToken, retryNotBefore, tenantSlug, credentialGeneration,
  isCurrent, persistRefresh, adopt, revoke, setRetryNotBefore,
}: DeviceRefreshOptions): void {
  useEffect(() => {
    if (!storedToken) return;
    let alive = true;
    const expiresAt = Date.parse(storedToken.expiresAt);
    const refreshAt = Math.max(Date.now() + 1_000, expiresAt - 60 * 60 * 1000, retryNotBefore);
    const operation = captureCredentialOperation(credentialGeneration.current, storedToken.token);
    const timer = setTimeout(() => {
      void (async () => {
        const refreshed = await refreshDevice(storedToken.token, tenantSlug);
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
        if (isCurrent(operation)) setRetryNotBefore(Date.now() + 60_000);
      })();
    }, refreshAt - Date.now());
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    storedToken, retryNotBefore, tenantSlug, credentialGeneration,
    isCurrent, persistRefresh, adopt, revoke, setRetryNotBefore,
  ]);
}
