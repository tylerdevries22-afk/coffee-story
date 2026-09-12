import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import { newOrderIds, type BoardOrder } from '@/features/operator/board';
import type { QueuedTransition } from '@/features/operator/offline-queue';
import { demoSyncEnabled } from '@/lib/demo-sync';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { dismissConflict, type OperatorConflict } from '@/state/operator-conflicts';
import {
  DEFAULT_DEMO_LOCATION,
  TENANT_DEMO_LOCATIONS,
  type OperatorLocation,
} from '@/state/operator-locations';
import { initialOrdersLoaded } from '@/state/operator-orders-loaded';

import { OperatorContext, type OperatorSettings, type OperatorState } from './operator-store-types';
import { useOperatorLiveSync } from './operator-live-sync';
import { useOperatorMenu } from './operator-menu';
import { useOperatorDemoSync } from './operator-demo-sync';
import { useOperatorActions } from './operator-actions';

export { DEMO_LOCATIONS, type OperatorLocation } from '@/state/operator-locations';
export { useOperator, type OperatorSettings } from './operator-store-types';

export function OperatorProvider({ children }: PropsWithChildren) {
  const { isDemo, tenant, liveLocations, user } = useAuth();
  const live = !isDemo && supabase !== null && tenant !== null;
  const richDemo = isDemo && DEMO_OPERATOR_FIXTURES.launch;

  /*
   * One roster, held by whoever is authoritative.
   *
   * With the shared demo plane on, that is the broker: seeding local fixtures
   * here as well produced two disjoint sets of orders on one screen, and the
   * local half could not be moved anywhere the wall would see -- which is
   * exactly what "pressing Ready does nothing" looked like. Start empty and
   * let the first reconcile (one second away) bring the shop in.
   */
  const brokered = demoSyncEnabled(richDemo);
  const [orders, setOrders] = useState<BoardOrder[]>(
    () => (brokered ? [] : [...DEMO_OPERATOR_FIXTURES.boardOrders]),
  );
  const [ordersLoaded, setOrdersLoaded] = useState(() => initialOrdersLoaded(brokered, live));
  const [unseenIds, setUnseenIds] = useState<ReadonlySet<string>>(new Set());
  const [location, setLocation] = useState<OperatorLocation>(DEFAULT_DEMO_LOCATION);
  const [settings, setSettings] = useState<OperatorSettings>({
    newOrderAlert: true,
    kdsMode: false,
    printerEnabled: false,
  });
  const [conflicts, setConflicts] = useState<OperatorConflict[]>([]);
  const [hoursOverride, setHoursOverride] = useState('');
  const queueRef = useRef<QueuedTransition[]>([]);
  const spawnIndex = useRef(0);
  const seenRef = useRef<Set<string>>(new Set(
    brokered ? [] : DEMO_OPERATOR_FIXTURES.boardOrders.map((order) => order.id),
  ));
  const ordersRef = useRef<BoardOrder[]>([]);
  const refundInFlightRef = useRef<Set<string>>(new Set());
  const syncedDemoIdsRef = useRef<Set<string>>(new Set());
  // The opening roster is not eight new orders arriving at once.
  const demoSyncPrimedRef = useRef(false);
  const demoModeRef = useRef(isDemo);
  const demoReconcileInFlightRef = useRef(false);
  const queueFlushInFlightRef = useRef(false);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  useEffect(() => {
    demoModeRef.current = isDemo;
  }, [isDemo]);
  useEffect(() => {
    if (isDemo || live) return;
    setOrders([]);
    setOrdersLoaded(false);
    seenRef.current = new Set();
    syncedDemoIdsRef.current = new Set();
    queueRef.current = [];
  }, [isDemo, live]);

  const locations = useMemo<readonly OperatorLocation[]>(() => live
    ? liveLocations.map((entry) => ({
      id: entry.id,
      name: entry.name,
      timezone: entry.timezone?.trim() || 'UTC',
    }))
    : TENANT_DEMO_LOCATIONS, [live, liveLocations]);
  const locationReady = !live || locations.some((entry) => entry.id === location.id);

  // Keep the working location inside the roster the account may work.
  useEffect(() => {
    if (!locations.some((entry) => entry.id === location.id)) {
      const first = locations[0];
      if (first) setLocation(first);
    }
  }, [location.id, locations]);

  const trackFresh = useCallback((merged: BoardOrder[]) => {
    const fresh = newOrderIds(seenRef.current, merged);
    if (fresh.length > 0) {
      setUnseenIds((ids) => new Set([...ids, ...fresh]));
      for (const id of fresh) seenRef.current.add(id);
    }
  }, []);

  const flushQueue = useOperatorLiveSync({ live, location, locationReady, queueFlushInFlightRef,
    queueRef, seenRef, setConflicts, setOrders, setOrdersLoaded, tenant, trackFresh, user });

  const markSeen = useCallback(() => setUnseenIds(new Set()), []);
  const reconcileDemoSync = useOperatorDemoSync({ brokered, demoModeRef,
    demoReconcileInFlightRef, demoSyncPrimedRef, queueRef, richDemo, seenRef, setConflicts,
    setOrders, setOrdersLoaded, spawnIndex, syncedDemoIdsRef, trackFresh });
  const dismissConflictAction = useCallback((id: string) => {
    setConflicts((existing) => dismissConflict(existing, id));
  }, []);

  const { advance, cancel, refund } = useOperatorActions({ flushQueue, live, location,
    locationReady, ordersRef, queueRef, reconcileDemoSync, refundInFlightRef, setConflicts,
    setOrders, syncedDemoIdsRef });

  const updateSettings = useCallback((patch: Partial<OperatorSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const { eightySixed, menuItems, orderingPaused, setOrderingPaused, toggleEightySix } =
    useOperatorMenu({ live, location, locationReady, tenant });



  const value = useMemo<OperatorState>(() => ({
    orders,
    ordersLoaded,
    unseenIds,
    markSeen,
    advance,
    refund,
    cancel,
    location,
    setLocation,
    locations,
    locationReady,
    settings,
    updateSettings,
    menuItems,
    eightySixed,
    toggleEightySix,
    orderingPaused,
    setOrderingPaused,
    hoursOverride,
    setHoursOverride,
    conflicts,
    dismissConflict: dismissConflictAction,
  }), [advance, cancel, conflicts, dismissConflictAction, eightySixed, hoursOverride, location,
    locationReady, locations, markSeen, menuItems, orders, ordersLoaded, orderingPaused, refund,
    setOrderingPaused, settings, toggleEightySix, unseenIds, updateSettings]);

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}
