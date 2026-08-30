/**
 * Operator-side state: the board's orders, device settings, the location
 * this tablet is working, and menu control (86 / pause).
 *
 * Two planes behind one shape. Demo feeds itself locally and spawns orders.
 * Live reads the location's working set under the staff JWT's RLS, streams
 * changes over Realtime, and — by design (rule 2) — advances an order by
 * inserting the order_events row directly: the database trigger is the state
 * machine, so an illegal move is rejected server-side and surfaced here as a
 * conflict. Status changes go through the offline queue in both planes, so
 * the exact reconcile path the live sync depends on is the one exercised
 * daily in demo.
 */
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
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '@platform/api-client';
import {
  fetchActiveLocationOrders,
  fetchLocationOrderStatuses,
  orderBoardEntryFromRow,
  abortRead,
  readWithRetry,
  subscribeToLocationSettings,
  subscribeToLocationOrders,
  subscribeToMenu,
} from '@platform/data';
import { canTransition, type OrderRow, type OrderStatus } from '@platform/schema';

import { initialDemoOrders, spawnDemoOrder } from '@/data/demo-orders';
import { canCancelWithoutRefund, newOrderIds, type BoardOrder } from '@/features/operator/board';
import { normalizeBoardOrderGuest, upsertBoardOrder } from '@/features/operator/live-board';
import {
  enqueueTransition,
  type QueuedTransition,
} from '@/features/operator/offline-queue';
import {
  drainTransitionQueue,
  enqueueSharedTransition,
  finalizeTransitionDrain,
  loadTransitionQueue,
  refreshTransitionStatuses,
  runQueueOperation,
  saveTransitionQueue,
  transitionQueueNeedsRefresh,
} from '@/features/operator/persistent-queue';
import {
  RefundAttemptError,
  refundFailureIsConclusive,
  runRefundAttempt,
} from '@/features/operator/refund-attempt';
import { platformApi } from '@/lib/api';
import { demoSyncClient, demoSyncEnabled } from '@/lib/demo-sync';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';

export type OperatorLocation = { id: string; name: string; timezone: string };

/** Multi-location demo roster; a single-location brand just never shows the picker. */
export const DEMO_LOCATIONS: readonly OperatorLocation[] = [
  { id: 'loc-havana', name: 'Havana St', timezone: 'America/Denver' },
  { id: 'loc-downtown', name: 'Downtown', timezone: 'America/Denver' },
];
const DEFAULT_DEMO_LOCATION: OperatorLocation = DEMO_LOCATIONS[0] ?? {
  id: 'demo-location', name: 'Demo location', timezone: 'America/Denver',
};

/** How often the live board re-fetches to catch missed realtime messages
 * and to flush transitions queued while offline. */
const LIVE_RECONCILE_MS = 60_000;
const DEMO_SYNC_RECONCILE_MS = 1_000;
const QUEUE_REQUEST_TIMEOUT_MS = 5_000;

export type OperatorSettings = {
  newOrderAlert: boolean;
  kdsMode: boolean;       // large type, no prices, for a kitchen screen
  printerEnabled: boolean;
};

type OperatorState = {
  orders: BoardOrder[];
  /** Ids that arrived since the board was last looked at. */
  unseenIds: ReadonlySet<string>;
  markSeen: () => void;
  advance: (orderId: string, to: OrderStatus) => void;
  refund: (orderId: string, amountCents: number | 'full') => void;
  cancel: (orderId: string) => void;

  location: OperatorLocation;
  setLocation: (location: OperatorLocation) => void;
  /** The roster the picker shows: claims-scoped live, the demo pair otherwise. */
  locations: readonly OperatorLocation[];
  /** False while a live account is still resolving its claims-scoped roster. */
  locationReady: boolean;

  settings: OperatorSettings;
  updateSettings: (patch: Partial<OperatorSettings>) => void;

  /** Menu control: 86'd item slugs, ordering pause, and a hours note. */
  eightySixed: ReadonlySet<string>;
  toggleEightySix: (itemId: string) => void;
  orderingPaused: boolean;
  setOrderingPaused: (paused: boolean) => void;
  hoursOverride: string;
  setHoursOverride: (note: string) => void;

  /** Orders whose queued change conflicted at reconcile time. */
  conflicts: readonly { orderId: string; message: string }[];
};

const OperatorContext = createContext<OperatorState | null>(null);

export function OperatorProvider({ children }: PropsWithChildren) {
  const { isDemo, tenant, liveLocations, user } = useAuth();
  const live = !isDemo && supabase !== null && tenant !== null;

  /*
   * One roster, held by whoever is authoritative.
   *
   * With the shared demo plane on, that is the broker: seeding local fixtures
   * here as well produced two disjoint sets of orders on one screen, and the
   * local half could not be moved anywhere the wall would see -- which is
   * exactly what "pressing Ready does nothing" looked like. Start empty and
   * let the first reconcile (one second away) bring the shop in.
   */
  const brokered = demoSyncEnabled(isDemo);
  const [orders, setOrders] = useState<BoardOrder[]>(
    () => (brokered ? [] : initialDemoOrders()),
  );
  const [unseenIds, setUnseenIds] = useState<ReadonlySet<string>>(new Set());
  const [location, setLocation] = useState<OperatorLocation>(DEFAULT_DEMO_LOCATION);
  const [settings, setSettings] = useState<OperatorSettings>({
    newOrderAlert: true,
    kdsMode: false,
    printerEnabled: false,
  });
  const [conflicts, setConflicts] = useState<{ orderId: string; message: string }[]>([]);
  const [eightySixed, setEightySixed] = useState<ReadonlySet<string>>(new Set());
  const [orderingPaused, setOrderingPausedState] = useState(false);
  const [hoursOverride, setHoursOverride] = useState('');
  const queueRef = useRef<QueuedTransition[]>([]);
  const spawnIndex = useRef(0);
  const seenRef = useRef<Set<string>>(new Set(
    brokered ? [] : initialDemoOrders().map((order) => order.id),
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
    : DEMO_LOCATIONS, [live, liveLocations]);
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

  /** Live board fetch, mapped once by the shared KDS projection. */
  const fetchLiveBoard = useCallback(async (): Promise<BoardOrder[] | null> => {
    if (!supabase || !tenant || !locationReady) return null;
    const rows = await fetchActiveLocationOrders(supabase, location.id, {
      attempts: 2,
      timeoutMs: QUEUE_REQUEST_TIMEOUT_MS,
    });
    return rows.map(orderBoardEntryFromRow);
  }, [location.id, locationReady, tenant]);

  /**
   * Flush the queue against the given server statuses, inserting the
   * surviving transitions as order_events under RLS. Transitions that fail
   * on a network error stay queued; server rejections become conflicts.
   */
  const flushQueue = useCallback(async (serverStatus: ReadonlyMap<string, OrderStatus>) => {
    if (!supabase || !tenant || queueRef.current.length === 0 || queueFlushInFlightRef.current) return;
    queueFlushInFlightRef.current = true;
    const database = supabase;
    const brandId = tenant.brand_id;
    let knownStatus = new Map(serverStatus);
    try {
      while (queueRef.current.length > 0) {
        const started = queueRef.current;
        // An action can be queued for a realtime arrival while the previous
        // drain awaits the database. Refresh this immutable batch before a
        // missing status is interpreted as a deleted order and discarded.
        const refreshed = await refreshTransitionStatuses(
          started,
          knownStatus,
          () => fetchLocationOrderStatuses(
            database,
            location.id,
            started.map((transition) => transition.orderId),
            {
              attempts: 2,
              timeoutMs: QUEUE_REQUEST_TIMEOUT_MS,
            },
          ),
        );
        if (!refreshed) break;
        knownStatus = refreshed;
        const drained = await drainTransitionQueue(started, knownStatus, async (transition) => {
          try {
            const inserted = await runQueueOperation((signal) => database
              .from('order_events')
              .insert({
                brand_id: brandId, order_id: transition.orderId, type: transition.to,
                source: 'operator', actor_user_id: user?.id ?? null,
              })
              .abortSignal(signal), QUEUE_REQUEST_TIMEOUT_MS);
            if (inserted.error) {
              return inserted.error.code
                ? { outcome: 'rejected', message: `The change was rejected: ${inserted.error.message}` }
                : { outcome: 'retry' };
            }
            knownStatus.set(transition.orderId, transition.to);
            return { outcome: 'confirmed' };
          } catch {
            return { outcome: 'retry' };
          }
        });
        queueRef.current = finalizeTransitionDrain(queueRef.current, started, drained.remaining);
        void saveTransitionQueue(AsyncStorage, location.id, queueRef.current);
        if (drained.conflicts.length > 0) {
          setConflicts((existing) => [...existing, ...drained.conflicts.map((conflict) => ({
            orderId: conflict.transition.orderId,
            message: conflict.serverStatus
              ? `${conflict.message} Server status: ${conflict.serverStatus}.`
              : `${conflict.message} The order no longer exists.`,
          }))]);
          setOrders((current) => current.map((order) => {
            const conflict = drained.conflicts.find((entry) => entry.transition.orderId === order.id);
            return conflict?.serverStatus ? { ...order, status: conflict.serverStatus } : order;
          }));
        }
        if (drained.remaining.length > 0) break;
      }
    } finally {
      queueFlushInFlightRef.current = false;
    }
  }, [location.id, tenant, user?.id]);

  const reconcileLive = useCallback(async () => {
    try {
      const board = await fetchLiveBoard();
      if (!board) return;
      const hadQueued = queueRef.current.length > 0;
      await flushQueue(new Map(board.map((order) => [order.id, order.status] as const)));
      // Flushed transitions changed server state; read it back rather than
      // guessing what the trigger accepted.
      const next = (hadQueued ? await fetchLiveBoard() : null) ?? board;
      setOrders(next);
      trackFresh(next);
    } catch {
      // Offline or mid-restart: keep the last board and the queue; the next
      // tick retries.
    }
  }, [fetchLiveBoard, flushQueue, trackFresh]);

  // Live: initial fetch + realtime channel + the reconcile heartbeat.
  useEffect(() => {
    if (!live) return undefined;
    setOrders([]);
    seenRef.current = new Set();
    queueRef.current = [];
    if (!locationReady) return undefined;
    let active = true;
    void loadTransitionQueue(AsyncStorage, location.id).then((stored) => {
      if (!active) return;
      queueRef.current = stored;
      return reconcileLive();
    });
    const unsubscribe = subscribeToLocationOrders(supabase, location.id, (event) => {
      if (event.kind !== 'order') return;
      const row = event.order as OrderRow;
      setOrders((current) => {
        const next = upsertBoardOrder(
          current,
          orderBoardEntryFromRow(row),
        );
        trackFresh(next);
        return next;
      });
    });
    const timer = setInterval(() => void reconcileLive(), LIVE_RECONCILE_MS);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [live, location.id, locationReady, reconcileLive, trackFresh]);

  // Live menu control state: 86'd slugs and the location's pause flag.
  useEffect(() => {
    if (!live || !locationReady || !supabase || !tenant) return undefined;
    let active = true;
    const database = supabase;
    const readMenu = () => {
      void readWithRetry('operator menu availability', (signal) => abortRead(database
        .from('menu_items')
        .select('slug, is_86d')
        .eq('brand_id', tenant.brand_id)
        .eq('is_86d', true), signal)
        .returns<{ slug: string; is_86d: boolean }[]>())
        .then((rows) => {
          if (active) setEightySixed(new Set((rows ?? []).map((item) => item.slug)));
        })
        .catch(() => undefined);
    };
    const readLocation = () => {
      void readWithRetry('operator location settings', (signal) => abortRead(database
        .from('locations')
        .select('ordering_paused')
        .eq('id', location.id), signal)
        .maybeSingle<{ ordering_paused: boolean }>())
        .then((row) => {
          if (active && row) setOrderingPausedState(row.ordering_paused);
        })
        .catch(() => undefined);
    };
    readMenu();
    readLocation();
    const unsubscribeMenu = subscribeToMenu(database, tenant.brand_id, readMenu);
    const unsubscribeLocation = subscribeToLocationSettings(database, location.id, readLocation);
    return () => {
      active = false;
      unsubscribeMenu();
      unsubscribeLocation();
    };
  }, [live, location.id, locationReady, tenant]);

  // The demo shop stays busy: a new order lands every couple of minutes. On the
  // shared plane the kiosk and customer apps do that for real, through the
  // broker, so a local spawn here would only re-create the phantom orders the
  // wall cannot see.
  useEffect(() => {
    if (!isDemo || brokered) return undefined;
    const timer = setInterval(() => {
      const next = spawnDemoOrder(spawnIndex.current++);
      setOrders((current) => {
        const merged = [...current, next];
        trackFresh(merged);
        return merged;
      });
    }, 120_000);
    return () => clearInterval(timer);
  }, [brokered, isDemo, trackFresh]);

  const markSeen = useCallback(() => setUnseenIds(new Set()), []);

  const reconcileDemoSync = useCallback(async () => {
    const client = demoSyncClient;
    if (!client || !demoModeRef.current || demoReconcileInFlightRef.current) return;
    demoReconcileInFlightRef.current = true;
    try {
      let snapshot = await client.orders();
      if (queueRef.current.length > 0) {
        const started = queueRef.current;
        let knownStatus = new Map(snapshot.orders.map((order) => [order.id, order.status] as const));
        if (transitionQueueNeedsRefresh(started)) {
          snapshot = await client.orders();
          knownStatus = new Map(snapshot.orders.map((order) => [order.id, order.status] as const));
        }
        const drained = await drainTransitionQueue(
          started,
          knownStatus,
          async (transition) => {
            try {
              await client.transition(transition.orderId, transition.to);
              return { outcome: 'confirmed' };
            } catch (error) {
              return error instanceof ApiError
                ? { outcome: 'rejected', message: error.message }
                : { outcome: 'retry' };
            }
          },
        );
        queueRef.current = finalizeTransitionDrain(queueRef.current, started, drained.remaining);
        if (drained.conflicts.length > 0) {
          setConflicts((existing) => [...existing, ...drained.conflicts.map((conflict) => ({
            orderId: conflict.transition.orderId,
            message: `${conflict.message} The shared demo kept its server status.`,
          }))]);
        }
        if (drained.remaining.length === 0) snapshot = await client.orders();
      }
      if (!demoModeRef.current) return;
      const nextIds = new Set(snapshot.orders.map((order) => order.id));
      if (!demoSyncPrimedRef.current) {
        for (const id of nextIds) seenRef.current.add(id);
        demoSyncPrimedRef.current = true;
      }
      setOrders((current) => {
        const local = current.filter((order) => !syncedDemoIdsRef.current.has(order.id));
        const merged = [...local, ...snapshot.orders.map(normalizeBoardOrderGuest)];
        syncedDemoIdsRef.current = nextIds;
        trackFresh(merged);
        return merged;
      });
    } catch {
      // The wall may be launching; keep the last good snapshot and retry.
    } finally {
      demoReconcileInFlightRef.current = false;
    }
  }, [trackFresh]);

  useEffect(() => {
    if (!demoSyncEnabled(isDemo)) return undefined;
    void reconcileDemoSync();
    const timer = setInterval(() => void reconcileDemoSync(), DEMO_SYNC_RECONCILE_MS);
    // Only the interval is torn down here. Clearing `demoModeRef` was a latch:
    // `reconcileDemoSync` returns early while it is false, and nothing but a
    // change of `isDemo` ever set it back -- so any re-run of this effect that
    // was not a mode change (a new `reconcileDemoSync` identity, a remount)
    // stopped the operator syncing for the rest of the session, silently.
    return () => clearInterval(timer);
  }, [isDemo, reconcileDemoSync]);

  /**
   * Queue then apply. Demo's "server" is local state, so the queue reconciles
   * immediately; live applies optimistically, writes the order_events row,
   * and lets the reconcile heartbeat repair anything the server refused.
   */
  const applyTransition = useCallback((orderId: string, to: OrderStatus) => {
    const transition: QueuedTransition = {
      orderId,
      to,
      queuedAt: new Date().toISOString(),
    };
    if (live && locationReady) {
      queueRef.current = enqueueTransition(queueRef.current, transition);
      void saveTransitionQueue(AsyncStorage, location.id, queueRef.current);
      const serverStatus = new Map(ordersRef.current.map((order) => [order.id, order.status] as const));
      setOrders((current) => current.map((order) => (
        order.id === orderId && canTransition(order.status, to)
          ? { ...order, status: to }
          : order
      )));
      void flushQueue(serverStatus);
      return;
    }
    if (demoSyncClient && syncedDemoIdsRef.current.has(orderId)) {
      queueRef.current = enqueueSharedTransition(queueRef.current, transition, true);
      setOrders((current) => current.map((order) => (
        order.id === orderId && canTransition(order.status, to) ? { ...order, status: to } : order
      )));
      // `reconcileDemoSync` removes this intent only after the broker confirms
      // it. A transport failure leaves it queued for the one-second heartbeat.
      void reconcileDemoSync();
      return;
    }
    // Fixture transitions are local-only. In particular, they never inspect or
    // clear the broker queue, which may contain a synchronized tap still in flight.
    setOrders((current) => current.map((order) => (
      order.id === orderId && canTransition(order.status, to)
        ? { ...order, status: to }
        : order
    )));
  }, [flushQueue, live, location.id, locationReady, reconcileDemoSync]);

  const advance = useCallback((orderId: string, to: OrderStatus) => {
    applyTransition(orderId, to);
  }, [applyTransition]);

  const cancel = useCallback((orderId: string) => {
    const order = ordersRef.current.find((candidate) => candidate.id === orderId);
    if (!order || !canCancelWithoutRefund(order)) {
      setConflicts((existing) => [
        ...existing,
        {
          orderId,
          message: 'Only unpaid pay-at-pickup orders can be cancelled directly. Refund a paid card order instead.',
        },
      ]);
      return;
    }
    applyTransition(orderId, 'cancelled');
  }, [applyTransition]);

  const refund = useCallback((orderId: string, amountCents: number | 'full') => {
    if (!live) {
      applyTransition(orderId, 'refunded');
      return;
    }
    // Live, money moves at Square before any event is written, and only the
    // server holds the location's token — so unlike every other transition
    // this one is a request, and the board waits for its answer rather than
    // advancing optimistically.
    const api = platformApi;
    if (!api) {
      setConflicts((existing) => [
        ...existing,
        { orderId, message: 'This device has no payments connection configured. Nothing was changed.' },
      ]);
      return;
    }
    if (refundInFlightRef.current.has(orderId)) return;
    refundInFlightRef.current.add(orderId);
    void runRefundAttempt(
      AsyncStorage,
      { orderId, amountCents },
      (idempotencyKey) => api.refundOrder({ orderId, amountCents }, idempotencyKey),
    ).catch((error: unknown) => {
      const conclusive = refundFailureIsConclusive(error);
      setConflicts((existing) => [
        ...existing,
        {
          orderId,
          message: error instanceof RefundAttemptError
            ? error.message
            : error instanceof Error
              ? conclusive
              ? `${error.message} No refund was submitted.`
              : `${error.message} The outcome is uncertain; retry the same amount to safely check it.`
            : 'The refund outcome is uncertain; retry the same amount to safely check it.',
        },
      ]);
    }).finally(() => {
      refundInFlightRef.current.delete(orderId);
    });
  }, [applyTransition, live]);

  const updateSettings = useCallback((patch: Partial<OperatorSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const toggleEightySix = useCallback((itemId: string) => {
    const turningOn = !eightySixed.has(itemId);
    setEightySixed((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    if (live && supabase && tenant) {
      void supabase
        .from('menu_items')
        .update({ is_86d: turningOn })
        .eq('brand_id', tenant.brand_id)
        .eq('slug', itemId)
        .then((result) => {
          if (result.error) {
            // Roll the optimistic flip back so the sheet shows the truth.
            setEightySixed((current) => {
              const next = new Set(current);
              if (turningOn) next.delete(itemId);
              else next.add(itemId);
              return next;
            });
          }
        });
    }
  }, [eightySixed, live, tenant]);

  const setOrderingPaused = useCallback((paused: boolean) => {
    setOrderingPausedState(paused);
    if (live && locationReady && supabase && tenant) {
      void supabase
        .from('locations')
        .update({ ordering_paused: paused })
        .eq('id', location.id)
        .then((result) => {
          if (result.error) setOrderingPausedState(!paused);
        });
    }
  }, [live, location.id, locationReady, tenant]);

  const value = useMemo<OperatorState>(() => ({
    orders,
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
    eightySixed,
    toggleEightySix,
    orderingPaused,
    setOrderingPaused,
    hoursOverride,
    setHoursOverride,
    conflicts,
  }), [advance, cancel, conflicts, eightySixed, hoursOverride, location, locationReady, locations, markSeen, orders, orderingPaused, refund, setOrderingPaused, settings, toggleEightySix, unseenIds, updateSettings]);

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorState {
  const context = useContext(OperatorContext);
  if (!context) throw new Error('useOperator requires OperatorProvider');
  return context;
}
