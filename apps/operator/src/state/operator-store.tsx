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

import {
  fetchActiveLocationOrders,
  subscribeToLocationOrders,
} from '@platform/data';
import { canTransition, type OrderRow, type OrderStatus } from '@platform/schema';

import { initialDemoOrders, spawnDemoOrder } from '@/data/demo-orders';
import { newOrderIds, type BoardOrder } from '@/features/operator/board';
import { boardOrderFromRow, upsertBoardOrder } from '@/features/operator/live-board';
import {
  enqueueTransition,
  reconcileQueue,
  type QueuedTransition,
} from '@/features/operator/offline-queue';
import { platformApi } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';

export type OperatorLocation = { id: string; name: string };

/** Multi-location demo roster; a single-location brand just never shows the picker. */
export const DEMO_LOCATIONS: readonly OperatorLocation[] = [
  { id: 'loc-havana', name: 'Havana St' },
  { id: 'loc-downtown', name: 'Downtown' },
];

/** How often the live board re-fetches to catch missed realtime messages
 * and to flush transitions queued while offline. */
const LIVE_RECONCILE_MS = 60_000;

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

  const [orders, setOrders] = useState<BoardOrder[]>(() => initialDemoOrders());
  const [unseenIds, setUnseenIds] = useState<ReadonlySet<string>>(new Set());
  const [location, setLocation] = useState<OperatorLocation>(DEMO_LOCATIONS[0]!);
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
  const seenRef = useRef<Set<string>>(new Set(initialDemoOrders().map((order) => order.id)));
  const namesRef = useRef<Map<string, string>>(new Map());
  const ordersRef = useRef<BoardOrder[]>([]);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const locations: readonly OperatorLocation[] = live && liveLocations.length > 0
    ? liveLocations
    : DEMO_LOCATIONS;

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

  /** Live board fetch: rows, then the guests' names staff RLS allows. */
  const fetchLiveBoard = useCallback(async (): Promise<BoardOrder[] | null> => {
    if (!supabase || !tenant) return null;
    const rows = await fetchActiveLocationOrders(supabase, location.id);
    const unknownCustomers = [...new Set(
      rows.map((row) => row.customer_id).filter((id): id is string => Boolean(id && !namesRef.current.has(id))),
    )];
    if (unknownCustomers.length > 0) {
      const named = await supabase
        .from('customers')
        .select('id, full_name')
        .in('id', unknownCustomers)
        .returns<{ id: string; full_name: string }[]>();
      for (const customer of named.data ?? []) {
        namesRef.current.set(customer.id, customer.full_name || 'Guest');
      }
    }
    return rows.map((row) => boardOrderFromRow(
      row,
      row.customer_id ? namesRef.current.get(row.customer_id) ?? 'Guest' : 'Guest',
    ));
  }, [location.id, tenant]);

  /**
   * Flush the queue against the given server statuses, inserting the
   * surviving transitions as order_events under RLS. Transitions that fail
   * on a network error stay queued; server rejections become conflicts.
   */
  const flushQueue = useCallback(async (serverStatus: ReadonlyMap<string, OrderStatus>) => {
    if (!supabase || !tenant || queueRef.current.length === 0) return;
    const { apply, conflicts: dropped } = reconcileQueue(queueRef.current, serverStatus);
    queueRef.current = [];
    if (dropped.length > 0) {
      setConflicts((existing) => [
        ...existing,
        ...dropped.map((conflict) => ({
          orderId: conflict.transition.orderId,
          message: conflict.serverStatus
            ? `Order moved to ${conflict.serverStatus} elsewhere; your change was dropped.`
            : 'Order no longer exists; your change was dropped.',
        })),
      ]);
    }
    for (const transition of apply) {
      const inserted = await supabase.from('order_events').insert({
        brand_id: tenant.brand_id,
        order_id: transition.orderId,
        type: transition.to,
        source: 'operator',
        actor_user_id: user?.id ?? null,
      });
      if (inserted.error) {
        // A trigger/RLS rejection is final; anything else (network) retries
        // on the next reconcile tick.
        if (inserted.error.code) {
          setConflicts((existing) => [
            ...existing,
            { orderId: transition.orderId, message: `The change was rejected: ${inserted.error.message}` },
          ]);
        } else {
          queueRef.current = enqueueTransition(queueRef.current, transition);
        }
      }
    }
  }, [tenant, user?.id]);

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
    void reconcileLive();
    const unsubscribe = subscribeToLocationOrders(supabase, location.id, (event) => {
      if (event.kind !== 'order') return;
      const row = event.order as OrderRow;
      setOrders((current) => {
        const next = upsertBoardOrder(
          current,
          boardOrderFromRow(row, row.customer_id ? namesRef.current.get(row.customer_id) ?? '' : 'Guest'),
        );
        trackFresh(next);
        return next;
      });
    });
    const timer = setInterval(() => void reconcileLive(), LIVE_RECONCILE_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [live, location.id, reconcileLive, trackFresh]);

  // Live menu control state: 86'd slugs and the location's pause flag.
  useEffect(() => {
    if (!live || !supabase || !tenant) return undefined;
    let active = true;
    void supabase
      .from('menu_items')
      .select('slug, is_86d')
      .eq('brand_id', tenant.brand_id)
      .eq('is_86d', true)
      .returns<{ slug: string; is_86d: boolean }[]>()
      .then((result) => {
        if (active && result.data) setEightySixed(new Set(result.data.map((item) => item.slug)));
      });
    void supabase
      .from('locations')
      .select('ordering_paused')
      .eq('id', location.id)
      .maybeSingle<{ ordering_paused: boolean }>()
      .then((result) => {
        if (active && result.data) setOrderingPausedState(result.data.ordering_paused);
      });
    return () => {
      active = false;
    };
  }, [live, location.id, tenant]);

  // The demo shop stays busy: a new order lands every couple of minutes.
  useEffect(() => {
    if (live) return undefined;
    const timer = setInterval(() => {
      const next = spawnDemoOrder(spawnIndex.current++);
      setOrders((current) => {
        const merged = [...current, next];
        trackFresh(merged);
        return merged;
      });
    }, 120_000);
    return () => clearInterval(timer);
  }, [live, trackFresh]);

  const markSeen = useCallback(() => setUnseenIds(new Set()), []);

  /**
   * Queue then apply. Demo's "server" is local state, so the queue reconciles
   * immediately; live applies optimistically, writes the order_events row,
   * and lets the reconcile heartbeat repair anything the server refused.
   */
  const applyTransition = useCallback((orderId: string, to: OrderStatus) => {
    queueRef.current = enqueueTransition(queueRef.current, {
      orderId,
      to,
      queuedAt: new Date().toISOString(),
    });
    if (live) {
      const serverStatus = new Map(ordersRef.current.map((order) => [order.id, order.status] as const));
      setOrders((current) => current.map((order) => (
        order.id === orderId && canTransition(order.status, to)
          ? { ...order, status: to }
          : order
      )));
      void flushQueue(serverStatus);
      return;
    }
    setOrders((current) => {
      const serverStatus = new Map(current.map((order) => [order.id, order.status] as const));
      const { apply, conflicts: dropped } = reconcileQueue(queueRef.current, serverStatus);
      queueRef.current = [];
      if (dropped.length > 0) {
        setConflicts((existing) => [
          ...existing,
          ...dropped.map((conflict) => ({
            orderId: conflict.transition.orderId,
            message: conflict.serverStatus
              ? `Order moved to ${conflict.serverStatus} elsewhere; your change was dropped.`
              : 'Order no longer exists; your change was dropped.',
          })),
        ]);
      }
      if (apply.length === 0) return current;
      return current.map((order) => {
        const change = apply.find((entry) => entry.orderId === order.id);
        return change && canTransition(order.status, change.to)
          ? { ...order, status: change.to }
          : order;
      });
    });
  }, [flushQueue, live]);

  const advance = useCallback((orderId: string, to: OrderStatus) => {
    applyTransition(orderId, to);
  }, [applyTransition]);

  const cancel = useCallback((orderId: string) => {
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
    if (!platformApi) {
      setConflicts((existing) => [
        ...existing,
        { orderId, message: 'This device has no payments connection configured. Nothing was changed.' },
      ]);
      return;
    }
    void platformApi
      .refundOrder({ orderId, amountCents })
      .then(() => {
        // The refunded event the server wrote arrives over Realtime like any
        // other transition; nothing to apply here.
      })
      .catch((error: unknown) => {
        setConflicts((existing) => [
          ...existing,
          {
            orderId,
            message: error instanceof Error
              ? `${error.message} Nothing was changed.`
              : 'That refund did not go through. Nothing was changed.',
          },
        ]);
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
    if (live && supabase && tenant) {
      void supabase
        .from('locations')
        .update({ ordering_paused: paused })
        .eq('id', location.id)
        .then((result) => {
          if (result.error) setOrderingPausedState(!paused);
        });
    }
  }, [live, location.id, tenant]);

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
    settings,
    updateSettings,
    eightySixed,
    toggleEightySix,
    orderingPaused,
    setOrderingPaused,
    hoursOverride,
    setHoursOverride,
    conflicts,
  }), [advance, cancel, conflicts, eightySixed, hoursOverride, location, locations, markSeen, orders, orderingPaused, refund, setOrderingPaused, settings, toggleEightySix, unseenIds, updateSettings]);

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorState {
  const context = useContext(OperatorContext);
  if (!context) throw new Error('useOperator requires OperatorProvider');
  return context;
}
