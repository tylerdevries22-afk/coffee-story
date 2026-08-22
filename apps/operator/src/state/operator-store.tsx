/**
 * Operator-side state: the board's orders (demo feed for now; the live path
 * replays the same shapes from Realtime), device settings, the PIN latch,
 * and the location this tablet is working.
 *
 * Status changes go through the offline queue even in demo, so the exact
 * reconcile path the live sync uses is the one exercised daily.
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

import { initialDemoOrders, spawnDemoOrder } from '@/data/demo-orders';
import { newOrderIds, type BoardOrder } from '@/features/operator/board';
import {
  enqueueTransition,
  reconcileQueue,
  type QueuedTransition,
} from '@/features/operator/offline-queue';
import { canTransition, type OrderStatus } from '@platform/schema';

export type OperatorLocation = { id: string; name: string };

/** Multi-location demo roster; a single-location brand just never shows the picker. */
export const DEMO_LOCATIONS: readonly OperatorLocation[] = [
  { id: 'loc-havana', name: 'Havana St' },
  { id: 'loc-downtown', name: 'Downtown' },
];

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

  settings: OperatorSettings;
  updateSettings: (patch: Partial<OperatorSettings>) => void;

  /** Menu control: 86'd item ids, ordering pause, and a hours note. */
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
  const [orderingPaused, setOrderingPaused] = useState(false);
  const [hoursOverride, setHoursOverride] = useState('');
  const queueRef = useRef<QueuedTransition[]>([]);
  const spawnIndex = useRef(0);
  const seenRef = useRef<Set<string>>(new Set(initialDemoOrders().map((order) => order.id)));

  // The demo shop stays busy: a new order lands every couple of minutes.
  useEffect(() => {
    const timer = setInterval(() => {
      const next = spawnDemoOrder(spawnIndex.current++);
      setOrders((current) => {
        const merged = [...current, next];
        const fresh = newOrderIds(seenRef.current, merged);
        if (fresh.length > 0) {
          setUnseenIds((ids) => new Set([...ids, ...fresh]));
          for (const id of fresh) seenRef.current.add(id);
        }
        return merged;
      });
    }, 120_000);
    return () => clearInterval(timer);
  }, []);

  const markSeen = useCallback(() => setUnseenIds(new Set()), []);

  /**
   * Queue then apply. In demo the "server" is local state, so the queue
   * reconciles immediately; the live path holds the queue while offline and
   * reconciles against fetched state on reconnect (Phase 7 wiring).
   */
  const applyTransition = useCallback((orderId: string, to: OrderStatus) => {
    queueRef.current = enqueueTransition(queueRef.current, {
      orderId,
      to,
      queuedAt: new Date().toISOString(),
    });
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
  }, []);

  const advance = useCallback((orderId: string, to: OrderStatus) => {
    applyTransition(orderId, to);
  }, [applyTransition]);

  const cancel = useCallback((orderId: string) => {
    applyTransition(orderId, 'cancelled');
  }, [applyTransition]);

  const refund = useCallback((orderId: string, amountCents: number | 'full') => {
    // Demo refunds are always full-state transitions; the amount matters to
    // Square (Phase 7), not to the board's columns.
    void amountCents;
    applyTransition(orderId, 'refunded');
  }, [applyTransition]);

  const updateSettings = useCallback((patch: Partial<OperatorSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const toggleEightySix = useCallback((itemId: string) => {
    setEightySixed((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const value = useMemo<OperatorState>(() => ({
    orders,
    unseenIds,
    markSeen,
    advance,
    refund,
    cancel,
    location,
    setLocation,
    settings,
    updateSettings,
    eightySixed,
    toggleEightySix,
    orderingPaused,
    setOrderingPaused,
    hoursOverride,
    setHoursOverride,
    conflicts,
  }), [advance, cancel, conflicts, eightySixed, hoursOverride, location, markSeen, orders, orderingPaused, refund, settings, toggleEightySix, unseenIds, updateSettings]);

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorState {
  const context = useContext(OperatorContext);
  if (!context) throw new Error('useOperator requires OperatorProvider');
  return context;
}
