/**
 * The live menu, and what a screen draws while it is not there.
 *
 * Reads through the shared menu assembly and subscribes to its change signal.
 *
 * Three states a screen has to tell apart, and the middle one is the point:
 *
 *   demo         nothing configured; use the bundled capture catalog.
 *   live         real rows, kept current.
 *   unavailable  configured, but the read failed.
 *
 * `unavailable` deliberately does NOT fall back to the bundled catalog. That
 * catalog is one tenant's menu; serving it to another brand's tablet would
 * price their drinks wrong under their own logo, and a guest would have no way
 * to know. A kiosk that cannot read its menu says so and keeps retrying.
 */
import {
  fetchBrandConfig, fetchMenuTree, readWithRetry, subscribeToBrandConfig,
  subscribeToLocationSettings, subscribeToMenu,
} from '@platform/data';
import { EMPTY_KIOSK_MENU, type KioskMenu } from '@platform/domain';
import {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import { kioskMenuFromRows } from '@/data/menu-source';
import {
  DEMO_MENU, kioskConfigOf, MenuContext, RETRY_MS,
  type KioskMenuStatus, type KioskMenuValue,
} from '@/data/menu-store-context';
import { useKioskBrand } from '@/data/use-kiosk-brand';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useDevice } from '@/state/device';
import { TENANT_BRAND_CONFIG } from '@/tenant';

export type { KioskMenuStatus, KioskMenuValue } from '@/data/menu-store-context';

export function MenuProvider({ children }: PropsWithChildren) {
  const { brandId: deviceBrandId, locationId: deviceLocationId } = useDevice();
  const [menu, setMenu] = useState<KioskMenu>(hasSupabaseConfig ? EMPTY_KIOSK_MENU : DEMO_MENU);
  const [status, setStatus] = useState<KioskMenuStatus>(hasSupabaseConfig ? 'loading' : 'demo');
  const [kioskConfig, setKioskConfig] = useState<unknown>(hasSupabaseConfig ? null : TENANT_BRAND_CONFIG.kiosk);
  const [nonce, setNonce] = useState(0);
  const failures = useRef(0);
  const locationFailures = useRef(0);
  const { brandId, locationId, retry: retryBrand } = useKioskBrand({
    deviceBrandId, deviceLocationId, setKioskConfig, setStatus,
  });

  const refresh = useCallback(() => {
    failures.current = 0;
    locationFailures.current = 0;
    retryBrand();
    setNonce((n) => n + 1);
  }, [retryBrand]);

  useEffect(() => {
    const client = supabase;
    if (!client || brandId === null) return;
    let alive = true;
    let configRetry: ReturnType<typeof setTimeout> | null = null;
    let configFailures = 0;
    let menuRetry: ReturnType<typeof setTimeout> | null = null;
    let locationRetry: ReturnType<typeof setTimeout> | null = null;
    let orderingPaused = false;
    let menuReady = false;
    let pauseKnown = false;
    let menuGeneration = 0;
    let locationGeneration = 0;

    setStatus('loading');

    // A paired device can arrive with only a brand id. Read the public view
    // once, then reconcile on the narrow signal emitted by HQ saves. Failed
    // reads keep the last valid flow and retry with the same bounded backoff
    // as the menu, so a transient outage cannot strand a running kiosk.
    const readConfig = () => {
      void fetchBrandConfig(client, brandId)
        .then((config) => {
          if (!alive) return;
          if (configRetry) {
            clearTimeout(configRetry);
            configRetry = null;
          }
          configFailures = 0;
          setKioskConfig(kioskConfigOf(config));
        })
        .catch(() => {
          if (!alive) return;
          const wait = RETRY_MS[Math.min(configFailures, RETRY_MS.length - 1)] ?? 60_000;
          configFailures += 1;
          if (configRetry) clearTimeout(configRetry);
          configRetry = setTimeout(readConfig, wait);
        });
    };
    setKioskConfig(null);
    readConfig();
    const unsubscribeConfig = subscribeToBrandConfig(client, brandId, readConfig);

    const publishStatus = () => {
      if (!alive || !menuReady || !pauseKnown) return;
      setStatus(orderingPaused ? 'paused' : 'live');
    };

    const read = () => {
      const generation = ++menuGeneration;
      void fetchMenuTree(client, brandId)
        .then((tree) => {
          if (!alive || generation !== menuGeneration) return;
          if (menuRetry) {
            clearTimeout(menuRetry);
            menuRetry = null;
          }
          failures.current = 0;
          menuReady = true;
          setMenu(kioskMenuFromRows({
            categories: tree.categories,
            items: tree.categories.flatMap((category) => category.items),
            drops: tree.drops,
          }));
          publishStatus();
        })
        .catch(() => {
          if (!alive || generation !== menuGeneration) return;
          // A menu already on screen keeps selling. A shop that loses wifi for
          // thirty seconds should not stop taking orders: a dead kiosk during
          // a rush is a queue and lost revenue, where an item 86'd in the gap
          // is one apology at the hatch. Only a kiosk with NOTHING to show
          // says it is offline.
          //
          // The exposure is bounded by what the subscription is for: while the
          // read is failing no 86 arrives, so the stale window is however long
          // the outage lasts. That is the trade being made, not an oversight.
          setStatus((current) => (current === 'live' ? 'live' : 'unavailable'));
          const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)] ?? 60_000;
          failures.current += 1;
          if (menuRetry) clearTimeout(menuRetry);
          menuRetry = setTimeout(read, wait);
        });
    };

    read();
    const unsubscribe = subscribeToMenu(client, brandId, read);
    const readLocation = () => {
      if (!locationId) {
        setStatus('unavailable');
        return;
      }
      const generation = ++locationGeneration;
      void readWithRetry('fetch kiosk location settings', (signal) => client
        .from('locations')
        .select('ordering_paused')
        .eq('id', locationId)
        .abortSignal(signal)
        .maybeSingle<{ ordering_paused: boolean }>())
        .then((location) => {
          if (!alive || generation !== locationGeneration) return;
          if (!location) throw new Error('Location settings are unavailable.');
          if (locationRetry) {
            clearTimeout(locationRetry);
            locationRetry = null;
          }
          locationFailures.current = 0;
          pauseKnown = true;
          orderingPaused = location.ordering_paused;
          publishStatus();
        })
        .catch(() => {
          if (!alive || generation !== locationGeneration) return;
          pauseKnown = false;
          setStatus('unavailable');
          const wait = RETRY_MS[Math.min(locationFailures.current, RETRY_MS.length - 1)] ?? 60_000;
          locationFailures.current += 1;
          if (locationRetry) clearTimeout(locationRetry);
          locationRetry = setTimeout(readLocation, wait);
        });
    };
    readLocation();
    const unsubscribeLocation = locationId
      ? subscribeToLocationSettings(client, locationId, readLocation)
      : () => {};
    return () => {
      alive = false;
      if (menuRetry) clearTimeout(menuRetry);
      if (locationRetry) clearTimeout(locationRetry);
      if (configRetry) clearTimeout(configRetry);
      unsubscribe();
      unsubscribeLocation();
      unsubscribeConfig();
    };
  }, [brandId, locationId, nonce]);

  const value = useMemo<KioskMenuValue>(() => ({ menu, status, kioskConfig, refresh }), [menu, status, kioskConfig, refresh]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useKioskMenu(): KioskMenuValue {
  return useContext(MenuContext);
}
