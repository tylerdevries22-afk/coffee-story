/**
 * The live menu, and what a screen draws while it is not there.
 *
 * Reads through `@platform/data`'s `fetchMenuTree` — the same read the
 * customer app and the operator app make — so there is one assembly of the
 * menu tree rather than a fourth. `subscribeToMenu` then keeps it current:
 * migration 0027 published `menu_items`, `menu_categories` and `drops` so that
 * "a change made once should appear on every kiosk and display at once", and
 * until this existed nothing subscribed, so 86'ing an item reached no screen.
 *
 * Three states a screen has to tell apart, and the middle one is the point:
 *
 *   demo         nothing configured. The bundled catalog, for the web export
 *                and the capture recipes.
 *   live         real rows, kept current.
 *   unavailable  configured, but the read failed.
 *
 * `unavailable` deliberately does NOT fall back to the bundled catalog. That
 * catalog is one tenant's menu; serving it to another brand's tablet would
 * price their drinks wrong under their own logo, and a guest would have no way
 * to know. A kiosk that cannot read its menu says so and keeps retrying.
 */
import {
  fetchBrandBySlug, fetchBrandConfig, fetchMenuTree, readWithRetry, subscribeToBrandConfig,
  subscribeToLocationSettings, subscribeToMenu,
} from '@platform/data';
import { EMPTY_KIOSK_MENU, type KioskMenu } from '@platform/domain';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import { demoMenu, kioskMenuFromRows } from '@/data/menu-source';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useDevice } from '@/state/device';
import TENANT_BRAND_CONFIG from '@/tenant/brand.json';

export type KioskMenuStatus = 'demo' | 'loading' | 'live' | 'paused' | 'unavailable';

export type KioskMenuValue = {
  menu: KioskMenu;
  status: KioskMenuStatus;
  /** The resolved tenant kiosk flow. Updated through a payload-free signal. */
  kioskConfig: unknown;
  /** Read again now — the retry affordance on the unavailable screen. */
  refresh: () => void;
};

const DEMO_MENU = demoMenu();

const MenuContext = createContext<KioskMenuValue>({
  menu: DEMO_MENU, status: 'demo', kioskConfig: TENANT_BRAND_CONFIG.kiosk, refresh: () => {},
});

/** Backoff between failed reads. A kiosk retries all day; it must not spin. */
const RETRY_MS = [1_000, 4_000, 15_000, 60_000] as const;

export function MenuProvider({ children }: PropsWithChildren) {
  const { brandId: deviceBrandId, locationId: deviceLocationId } = useDevice();
  const [menu, setMenu] = useState<KioskMenu>(hasSupabaseConfig ? EMPTY_KIOSK_MENU : DEMO_MENU);
  const [status, setStatus] = useState<KioskMenuStatus>(hasSupabaseConfig ? 'loading' : 'demo');
  const [kioskConfig, setKioskConfig] = useState<unknown>(hasSupabaseConfig ? null : TENANT_BRAND_CONFIG.kiosk);
  const [nonce, setNonce] = useState(0);
  const failures = useRef(0);
  const locationFailures = useRef(0);
  const brandFailures = useRef(0);
  const [brandRetrySeq, setBrandRetrySeq] = useState(0);

  const refresh = useCallback(() => {
    failures.current = 0;
    locationFailures.current = 0;
    brandFailures.current = 0;
    setBrandRetrySeq((value) => value + 1);
    setNonce((n) => n + 1);
  }, []);

  // A paired device names its own brand. Before pairing there is still a
  // tenant — this binary is built per brand — so the slug resolves one, which
  // is what lets a kiosk be set up and previewed before it is paired.
  const [resolvedBrandId, setResolvedBrandId] = useState<string | null>(null);
  const [resolvedLocationId, setResolvedLocationId] = useState<string | null>(null);
  const brandId = deviceBrandId ?? resolvedBrandId;
  const locationId = deviceLocationId ?? resolvedLocationId;

  useEffect(() => {
    if (!supabase || deviceBrandId !== null || resolvedBrandId !== null) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    void fetchBrandBySlug(supabase, TENANT_BRAND_CONFIG.identity.slug)
      .then((summary) => {
        if (!alive) return;
        if (!summary) throw new Error('The configured brand is unavailable.');
        brandFailures.current = 0;
        setStatus('loading');
        setKioskConfig(kioskConfigOf(summary.brand.brand_config));
        setResolvedBrandId(summary.brand.id);
        setResolvedLocationId(summary.locations[0]?.id ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setStatus('unavailable');
        const wait = RETRY_MS[Math.min(brandFailures.current, RETRY_MS.length - 1)] ?? 60_000;
        brandFailures.current += 1;
        retry = setTimeout(() => setBrandRetrySeq((value) => value + 1), wait);
      });
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
    };
  }, [deviceBrandId, resolvedBrandId, brandRetrySeq]);

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

function kioskConfigOf(config: unknown): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return null;
  const kiosk = (config as Record<string, unknown>).kiosk;
  return typeof kiosk === 'object' && kiosk !== null && !Array.isArray(kiosk) ? kiosk : null;
}

export function useKioskMenu(): KioskMenuValue {
  return useContext(MenuContext);
}
