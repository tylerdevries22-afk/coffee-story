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
  fetchBrandBySlug, fetchMenuTree, subscribeToMenu,
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

export type KioskMenuStatus = 'demo' | 'loading' | 'live' | 'unavailable';

export type KioskMenuValue = {
  menu: KioskMenu;
  status: KioskMenuStatus;
  /** Read again now — the retry affordance on the unavailable screen. */
  refresh: () => void;
};

const DEMO_MENU = demoMenu();

const MenuContext = createContext<KioskMenuValue>({
  menu: DEMO_MENU, status: 'demo', refresh: () => {},
});

/** Backoff between failed reads. A kiosk retries all day; it must not spin. */
const RETRY_MS = [1_000, 4_000, 15_000, 60_000] as const;

export function MenuProvider({ children }: PropsWithChildren) {
  const { brandId: deviceBrandId } = useDevice();
  const [menu, setMenu] = useState<KioskMenu>(hasSupabaseConfig ? EMPTY_KIOSK_MENU : DEMO_MENU);
  const [status, setStatus] = useState<KioskMenuStatus>(hasSupabaseConfig ? 'loading' : 'demo');
  const [nonce, setNonce] = useState(0);
  const failures = useRef(0);

  const refresh = useCallback(() => {
    failures.current = 0;
    setNonce((n) => n + 1);
  }, []);

  // A paired device names its own brand. Before pairing there is still a
  // tenant — this binary is built per brand — so the slug resolves one, which
  // is what lets a kiosk be set up and previewed before it is paired.
  const [resolvedBrandId, setResolvedBrandId] = useState<string | null>(null);
  const brandId = deviceBrandId ?? resolvedBrandId;

  useEffect(() => {
    if (!supabase || deviceBrandId !== null || resolvedBrandId !== null) return;
    let alive = true;
    void fetchBrandBySlug(supabase, TENANT_BRAND_CONFIG.identity.slug)
      .then((summary) => {
        if (alive && summary) setResolvedBrandId(summary.brand.id);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [deviceBrandId, resolvedBrandId]);

  useEffect(() => {
    const client = supabase;
    if (!client || brandId === null) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const read = () => {
      void fetchMenuTree(client, brandId)
        .then((tree) => {
          if (!alive) return;
          failures.current = 0;
          setMenu(kioskMenuFromRows({
            categories: tree.categories,
            items: tree.categories.flatMap((category) => category.items),
            drops: tree.drops,
          }));
          setStatus('live');
        })
        .catch(() => {
          if (!alive) return;
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
          retry = setTimeout(read, wait);
        });
    };

    read();
    const unsubscribe = subscribeToMenu(client, brandId, read);
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      unsubscribe();
    };
  }, [brandId, nonce]);

  const value = useMemo<KioskMenuValue>(() => ({ menu, status, refresh }), [menu, status, refresh]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useKioskMenu(): KioskMenuValue {
  return useContext(MenuContext);
}
