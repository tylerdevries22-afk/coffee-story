import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { ApiError } from '@platform/api-client';
import type { BoardOrder } from '@/features/operator/board';
import type { QueuedTransition } from '@/features/operator/offline-queue';
import { drainTransitionQueue, finalizeTransitionDrain, transitionQueueNeedsRefresh } from '@/features/operator/persistent-queue';
import { spawnDemoOrder } from '@/data/demo-orders';
import { normalizeBoardOrderGuest } from '@/features/operator/live-board';
import { demoSyncClient, demoSyncEnabled } from '@/lib/demo-sync';

const DEMO_SYNC_RECONCILE_MS = 1_000;

type Options = {
  brokered: boolean; richDemo: boolean;
  demoModeRef: MutableRefObject<boolean>; demoReconcileInFlightRef: MutableRefObject<boolean>;
  demoSyncPrimedRef: MutableRefObject<boolean>; queueRef: MutableRefObject<QueuedTransition[]>;
  seenRef: MutableRefObject<Set<string>>; spawnIndex: MutableRefObject<number>;
  syncedDemoIdsRef: MutableRefObject<Set<string>>;
  setConflicts: Dispatch<SetStateAction<{ orderId: string; message: string }[]>>;
  setOrders: Dispatch<SetStateAction<BoardOrder[]>>; trackFresh: (orders: BoardOrder[]) => void;
};

export function useOperatorDemoSync(options: Options) {
  const { brokered, demoModeRef, demoReconcileInFlightRef, demoSyncPrimedRef, queueRef,
    richDemo, seenRef, setConflicts, setOrders, spawnIndex, syncedDemoIdsRef, trackFresh } = options;
  useEffect(() => {
    if (!richDemo || brokered) return undefined;
    const timer = setInterval(() => {
      const next = spawnDemoOrder(spawnIndex.current++);
      setOrders((current) => { const merged = [...current, next]; trackFresh(merged); return merged; });
    }, 120_000);
    return () => clearInterval(timer);
  }, [brokered, richDemo, setOrders, spawnIndex, trackFresh]);
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
        const drained = await drainTransitionQueue(started, knownStatus, async (transition) => {
          try { await client.transition(transition.orderId, transition.to); return { outcome: 'confirmed' }; }
          catch (error) { return error instanceof ApiError
            ? { outcome: 'rejected', message: error.message } : { outcome: 'retry' }; }
        });
        queueRef.current = finalizeTransitionDrain(queueRef.current, started, drained.remaining);
        if (drained.conflicts.length > 0) setConflicts((existing) => [...existing,
          ...drained.conflicts.map((conflict) => ({ orderId: conflict.transition.orderId,
            message: `${conflict.message} The shared demo kept its server status.` }))]);
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
        syncedDemoIdsRef.current = nextIds; trackFresh(merged); return merged;
      });
    } catch { /* Keep the last snapshot and retry. */ }
    finally { demoReconcileInFlightRef.current = false; }
  }, [demoModeRef, demoReconcileInFlightRef, demoSyncPrimedRef, queueRef, seenRef,
    setConflicts, setOrders, syncedDemoIdsRef, trackFresh]);
  useEffect(() => {
    if (!demoSyncEnabled(richDemo)) return undefined;
    void reconcileDemoSync();
    const timer = setInterval(() => void reconcileDemoSync(), DEMO_SYNC_RECONCILE_MS);
    return () => clearInterval(timer);
  }, [reconcileDemoSync, richDemo]);
  return reconcileDemoSync;
}
