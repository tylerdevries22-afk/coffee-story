import {
  fetchMenuTree,
  readWithRetry,
  subscribeToLocationSettings,
  subscribeToMenu,
} from '@platform/data';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { MENU_CATEGORY_META, MENU_ITEMS } from '@/data/catalog';
import { catalogAddOns, customerCatalogFromTree, type CustomerCatalog } from '@/data/live-catalog';
import { liveBrand } from '@/lib/live-portal';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { createRequestSequence } from '@platform/domain';
import { TENANT_MENU_MEDIA } from '@/tenant/menu-media';

export type CustomerCatalogStatus = 'demo' | 'loading' | 'live' | 'unavailable';
export type CustomerCatalogValue = CustomerCatalog & {
  status: CustomerCatalogStatus;
  orderingPaused: boolean;
  refresh: () => void;
};

const BUNDLED_CATALOG: CustomerCatalog = {
  categories: [...MENU_CATEGORY_META],
  items: [...MENU_ITEMS],
  addOns: catalogAddOns(MENU_ITEMS),
};
const DEMO_CATALOG: CustomerCatalogValue = {
  ...BUNDLED_CATALOG,
  status: 'demo',
  orderingPaused: false,
  refresh: () => {},
};
const RETRY_MS = [1_000, 4_000, 15_000, 60_000] as const;

const CatalogContext = createContext<CustomerCatalogValue>(DEMO_CATALOG);

export function CustomerCatalogProvider({ children }: PropsWithChildren) {
  const { isDemo } = useAuth();
  const [catalog, setCatalog] = useState<CustomerCatalog>(BUNDLED_CATALOG);
  const [status, setStatus] = useState<CustomerCatalogStatus>(isDemo ? 'demo' : 'loading');
  const [orderingPaused, setOrderingPaused] = useState(false);
  const [nonce, setNonce] = useState(0);
  const failures = useRef(0);
  const requests = useRef(createRequestSequence());
  const refresh = useCallback(() => {
    failures.current = 0;
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (isDemo || !supabase) {
      setCatalog(DEMO_CATALOG);
      setStatus('demo');
      setOrderingPaused(false);
      return undefined;
    }
    const client = supabase;
    const sequence = requests.current;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMenu = () => {};
    let unsubscribeLocation = () => {};
    setStatus('loading');

    const load = async () => {
      const requestId = sequence.begin();
      try {
        const brand = await liveBrand(client);
        const location = brand?.locations[0];
        if (!brand || !location) throw new Error('The tenant storefront is unavailable.');
        const [tree, locationSettings] = await Promise.all([
          fetchMenuTree(client, brand.brand.id),
          readWithRetry('fetch customer ordering settings', (signal) => client.from('locations')
            .select('ordering_paused').eq('id', location.id).abortSignal(signal)
            .single<{ ordering_paused: boolean }>()),
        ]);
        if (!active || !sequence.isCurrent(requestId)) return;
        if (!locationSettings) throw new Error('The tenant location is unavailable.');
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        failures.current = 0;
        setCatalog(customerCatalogFromTree(tree, MENU_CATEGORY_META, TENANT_MENU_MEDIA));
        setOrderingPaused(locationSettings.ordering_paused);
        setStatus('live');
        unsubscribeMenu();
        unsubscribeLocation();
        unsubscribeMenu = subscribeToMenu(client, brand.brand.id, () => void load());
        unsubscribeLocation = subscribeToLocationSettings(client, location.id, () => void load());
      } catch {
        if (!active || !sequence.isCurrent(requestId)) return;
        setStatus('unavailable');
        const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)] ?? 60_000;
        failures.current += 1;
        if (retry) clearTimeout(retry);
        retry = setTimeout(() => void load(), wait);
      }
    };
    void load();
    return () => {
      active = false;
      sequence.invalidate();
      if (retry) clearTimeout(retry);
      unsubscribeMenu();
      unsubscribeLocation();
    };
  }, [isDemo, nonce]);

  const value = useMemo<CustomerCatalogValue>(() => ({
    ...catalog, status, orderingPaused, refresh,
  }), [catalog, orderingPaused, refresh, status]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCustomerCatalog(): CustomerCatalogValue {
  return useContext(CatalogContext);
}
