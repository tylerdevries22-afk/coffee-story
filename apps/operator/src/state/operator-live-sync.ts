import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { fetchActiveLocationOrders, fetchLocationOrderStatuses, orderBoardEntryFromRow,
  subscribeToLocationOrders } from '@platform/data';
import type { OrderRow, OrderStatus, TenantClaims } from '@platform/schema';
import type { User } from '@supabase/supabase-js';
import type { BoardOrder } from '@/features/operator/board';
import { upsertBoardOrder } from '@/features/operator/live-board';
import type { QueuedTransition } from '@/features/operator/offline-queue';
import { drainTransitionQueue, finalizeTransitionDrain, loadTransitionQueue,
  refreshTransitionStatuses, runQueueOperation, saveTransitionQueue } from '@/features/operator/persistent-queue';
import { supabase } from '@/lib/supabase';
import { appendConflicts, type OperatorConflict } from '@/state/operator-conflicts';
import type { OperatorLocation } from '@/state/operator-locations';

const LIVE_RECONCILE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

type Options = {
  live: boolean; location: OperatorLocation; locationReady: boolean; tenant: TenantClaims | null;
  user: User | null; queueRef: MutableRefObject<QueuedTransition[]>;
  queueFlushInFlightRef: MutableRefObject<boolean>;
  seenRef: MutableRefObject<Set<string>>;
  setConflicts: Dispatch<SetStateAction<OperatorConflict[]>>;
  setOrders: Dispatch<SetStateAction<BoardOrder[]>>;
  setOrdersLoaded: Dispatch<SetStateAction<boolean>>;
  trackFresh: (orders: BoardOrder[]) => void;
};

export function useOperatorLiveSync(options: Options) {
  const { live, location, locationReady, queueFlushInFlightRef, queueRef, seenRef,
    setConflicts, setOrders, setOrdersLoaded, tenant, trackFresh, user } = options;
  const fetchLiveBoard = useCallback(async (): Promise<BoardOrder[] | null> => {
    if (!supabase || !tenant || !locationReady) return null;
    const rows = await fetchActiveLocationOrders(supabase, location.id, {
      attempts: 2, timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return rows.map(orderBoardEntryFromRow);
  }, [location.id, locationReady, tenant]);
  const flushQueue = useCallback(async (serverStatus: ReadonlyMap<string, OrderStatus>) => {
    if (!supabase || !tenant || queueRef.current.length === 0 || queueFlushInFlightRef.current) return;
    queueFlushInFlightRef.current = true;
    const database = supabase;
    let knownStatus = new Map(serverStatus);
    try {
      while (queueRef.current.length > 0) {
        const started = queueRef.current;
        const refreshed = await refreshTransitionStatuses(started, knownStatus,
          () => fetchLocationOrderStatuses(database, location.id,
            started.map((transition) => transition.orderId), { attempts: 2, timeoutMs: REQUEST_TIMEOUT_MS }));
        if (!refreshed) break;
        knownStatus = refreshed;
        const drained = await drainTransitionQueue(started, knownStatus, async (transition) => {
          try {
            const inserted = await runQueueOperation((signal) => database.from('order_events').insert({
              brand_id: tenant.brand_id, order_id: transition.orderId, type: transition.to,
              source: 'operator', actor_user_id: user?.id ?? null,
            }).abortSignal(signal), REQUEST_TIMEOUT_MS);
            if (inserted.error) return inserted.error.code
              ? { outcome: 'rejected', message: `The change was rejected: ${inserted.error.message}` }
              : { outcome: 'retry' };
            knownStatus.set(transition.orderId, transition.to);
            return { outcome: 'confirmed' };
          } catch { return { outcome: 'retry' }; }
        });
        queueRef.current = finalizeTransitionDrain(queueRef.current, started, drained.remaining);
        void saveTransitionQueue(AsyncStorage, location.id, queueRef.current);
        if (drained.conflicts.length > 0) {
          setConflicts((existing) => appendConflicts(existing, drained.conflicts.map((conflict) => ({
            orderId: conflict.transition.orderId,
            message: conflict.serverStatus ? `${conflict.message} Server status: ${conflict.serverStatus}.`
              : `${conflict.message} The order no longer exists.`,
          }))));
          setOrders((current) => current.map((order) => {
            const conflict = drained.conflicts.find((entry) => entry.transition.orderId === order.id);
            return conflict?.serverStatus ? { ...order, status: conflict.serverStatus } : order;
          }));
        }
        if (drained.remaining.length > 0) break;
      }
    } finally { queueFlushInFlightRef.current = false; }
  }, [location.id, queueFlushInFlightRef, queueRef, setConflicts, setOrders, tenant, user?.id]);
  const reconcileLive = useCallback(async () => {
    try {
      const board = await fetchLiveBoard();
      if (!board) return;
      const hadQueued = queueRef.current.length > 0;
      await flushQueue(new Map(board.map((order) => [order.id, order.status] as const)));
      const next = (hadQueued ? await fetchLiveBoard() : null) ?? board;
      setOrders(next); trackFresh(next); setOrdersLoaded(true);
    } catch { /* Keep the last board and retry. */ }
  }, [fetchLiveBoard, flushQueue, queueRef, setOrders, setOrdersLoaded, trackFresh]);
  useEffect(() => {
    if (!live) return undefined;
    // A fresh location starts unresolved again: the last board it showed
    // belonged to a different set of orders.
    setOrders([]); setOrdersLoaded(false); seenRef.current = new Set(); queueRef.current = [];
    if (!locationReady) return undefined;
    let active = true;
    void loadTransitionQueue(AsyncStorage, location.id).then((stored) => {
      if (!active) return; queueRef.current = stored; return reconcileLive();
    });
    const unsubscribe = subscribeToLocationOrders(supabase, location.id, (event) => {
      if (event.kind !== 'order') return;
      setOrders((current) => {
        const next = upsertBoardOrder(current, orderBoardEntryFromRow(event.order as OrderRow));
        trackFresh(next); return next;
      });
      setOrdersLoaded(true);
    });
    const timer = setInterval(() => void reconcileLive(), LIVE_RECONCILE_MS);
    return () => { active = false; unsubscribe(); clearInterval(timer); };
  }, [live, location.id, locationReady, queueRef, reconcileLive, seenRef, setOrders, setOrdersLoaded, trackFresh]);
  return flushQueue;
}
