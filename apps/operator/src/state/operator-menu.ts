import { useCallback, useEffect, useMemo, useState } from 'react';

import { abortRead, readWithRetry, subscribeToLocationSettings, subscribeToMenu } from '@platform/data';
import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import { supabase } from '@/lib/supabase';
import type { OperatorLocation } from '@/state/operator-locations';
import type { TenantClaims } from '@platform/schema';

export function useOperatorMenu({ live, location, locationReady, tenant }: {
  live: boolean; location: OperatorLocation; locationReady: boolean; tenant: TenantClaims | null;
}) {
  const [liveMenuItems, setLiveMenuItems] = useState<readonly { slug: string; name: string }[]>([]);
  const [eightySixed, setEightySixed] = useState<ReadonlySet<string>>(new Set());
  const [orderingPaused, setOrderingPausedState] = useState(false);
  useEffect(() => {
    if (!live || !locationReady || !supabase || !tenant) return undefined;
    let active = true;
    const database = supabase;
    const readMenu = () => {
      void readWithRetry('operator menu availability', (signal) => abortRead(database
        .from('menu_items').select('slug, name, is_86d').eq('brand_id', tenant.brand_id)
        .order('sort_order', { ascending: true }), signal)
        .returns<{ slug: string; name: string; is_86d: boolean }[]>())
        .then((rows) => {
          if (!active) return;
          setLiveMenuItems((rows ?? []).map((item) => ({ slug: item.slug, name: item.name })));
          setEightySixed(new Set((rows ?? []).filter((item) => item.is_86d).map((item) => item.slug)));
        }).catch(() => undefined);
    };
    const readLocation = () => {
      void readWithRetry('operator location settings', (signal) => abortRead(database
        .from('locations').select('ordering_paused').eq('id', location.id), signal)
        .maybeSingle<{ ordering_paused: boolean }>()).then((row) => {
          if (active && row) setOrderingPausedState(row.ordering_paused);
        }).catch(() => undefined);
    };
    readMenu(); readLocation();
    const unsubscribeMenu = subscribeToMenu(database, tenant.brand_id, readMenu);
    const unsubscribeLocation = subscribeToLocationSettings(database, location.id, readLocation);
    return () => { active = false; unsubscribeMenu(); unsubscribeLocation(); };
  }, [live, location.id, locationReady, tenant]);
  const toggleEightySix = useCallback((itemId: string) => {
    const turningOn = !eightySixed.has(itemId);
    setEightySixed((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
    if (live && supabase && tenant) void supabase.from('menu_items').update({ is_86d: turningOn })
      .eq('brand_id', tenant.brand_id).eq('slug', itemId).then((result) => {
        if (result.error) setEightySixed((current) => {
          const next = new Set(current);
          if (turningOn) next.delete(itemId); else next.add(itemId);
          return next;
        });
      });
  }, [eightySixed, live, tenant]);
  const setOrderingPaused = useCallback((paused: boolean) => {
    setOrderingPausedState(paused);
    if (live && locationReady && supabase && tenant) void supabase.from('locations')
      .update({ ordering_paused: paused }).eq('id', location.id).then((result) => {
        if (result.error) setOrderingPausedState(!paused);
      });
  }, [live, location.id, locationReady, tenant]);
  const menuItems = useMemo(() => live ? liveMenuItems : DEMO_OPERATOR_FIXTURES.orderableItems
    .map(({ slug, name }) => ({ slug, name })), [live, liveMenuItems]);
  return { eightySixed, menuItems, orderingPaused, setOrderingPaused, toggleEightySix };
}
