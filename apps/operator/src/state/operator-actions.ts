import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { OrderStatus } from '@platform/schema';
import { canTransition } from '@platform/schema';
import type { BoardOrder } from '@/features/operator/board';
import { canCancelWithoutRefund } from '@/features/operator/board';
import { enqueueTransition, type QueuedTransition } from '@/features/operator/offline-queue';
import { enqueueSharedTransition, saveTransitionQueue } from '@/features/operator/persistent-queue';
import { RefundAttemptError, refundFailureIsConclusive, runRefundAttempt } from '@/features/operator/refund-attempt';
import { platformApi } from '@/lib/api';
import { demoSyncClient } from '@/lib/demo-sync';
import type { OperatorLocation } from '@/state/operator-locations';

type Options = {
  flushQueue: (status: ReadonlyMap<string, OrderStatus>) => Promise<void>;
  live: boolean; location: OperatorLocation; locationReady: boolean;
  ordersRef: MutableRefObject<BoardOrder[]>; queueRef: MutableRefObject<QueuedTransition[]>;
  reconcileDemoSync: () => Promise<void>; refundInFlightRef: MutableRefObject<Set<string>>;
  setConflicts: Dispatch<SetStateAction<{ orderId: string; message: string }[]>>;
  setOrders: Dispatch<SetStateAction<BoardOrder[]>>; syncedDemoIdsRef: MutableRefObject<Set<string>>;
};

export function useOperatorActions(options: Options) {
  const { flushQueue, live, location, locationReady, ordersRef, queueRef, reconcileDemoSync,
    refundInFlightRef, setConflicts, setOrders, syncedDemoIdsRef } = options;
  const applyTransition = useCallback((orderId: string, to: OrderStatus) => {
    const transition: QueuedTransition = { orderId, to, queuedAt: new Date().toISOString() };
    if (live && locationReady) {
      queueRef.current = enqueueTransition(queueRef.current, transition);
      void saveTransitionQueue(AsyncStorage, location.id, queueRef.current);
      const serverStatus = new Map(ordersRef.current.map((order) => [order.id, order.status] as const));
      setOrders((current) => current.map((order) => order.id === orderId && canTransition(order.status, to)
        ? { ...order, status: to } : order));
      void flushQueue(serverStatus); return;
    }
    if (demoSyncClient && syncedDemoIdsRef.current.has(orderId)) {
      queueRef.current = enqueueSharedTransition(queueRef.current, transition, true);
      setOrders((current) => current.map((order) => order.id === orderId && canTransition(order.status, to)
        ? { ...order, status: to } : order));
      void reconcileDemoSync(); return;
    }
    setOrders((current) => current.map((order) => order.id === orderId && canTransition(order.status, to)
      ? { ...order, status: to } : order));
  }, [flushQueue, live, location.id, locationReady, ordersRef, queueRef, reconcileDemoSync,
    setOrders, syncedDemoIdsRef]);
  const advance = useCallback((orderId: string, to: OrderStatus) => applyTransition(orderId, to), [applyTransition]);
  const cancel = useCallback((orderId: string) => {
    const order = ordersRef.current.find((candidate) => candidate.id === orderId);
    if (!order || !canCancelWithoutRefund(order)) {
      setConflicts((existing) => [...existing, { orderId,
        message: 'Only unpaid pay-at-pickup orders can be cancelled directly. Refund a paid card order instead.' }]);
      return;
    }
    applyTransition(orderId, 'cancelled');
  }, [applyTransition, ordersRef, setConflicts]);
  const refund = useCallback((orderId: string, amountCents: number | 'full') => {
    if (!live) { applyTransition(orderId, 'refunded'); return; }
    const api = platformApi;
    if (!api) {
      setConflicts((existing) => [...existing, { orderId,
        message: 'This device has no payments connection configured. Nothing was changed.' }]);
      return;
    }
    if (refundInFlightRef.current.has(orderId)) return;
    refundInFlightRef.current.add(orderId);
    void runRefundAttempt(AsyncStorage, { orderId, amountCents },
      (idempotencyKey) => api.refundOrder({ orderId, amountCents }, idempotencyKey))
      .catch((error: unknown) => {
        const conclusive = refundFailureIsConclusive(error);
        setConflicts((existing) => [...existing, { orderId,
          message: error instanceof RefundAttemptError ? error.message : error instanceof Error
            ? conclusive ? `${error.message} No refund was submitted.`
              : `${error.message} The outcome is uncertain; retry the same amount to safely check it.`
            : 'The refund outcome is uncertain; retry the same amount to safely check it.' }]);
      }).finally(() => { refundInFlightRef.current.delete(orderId); });
  }, [applyTransition, live, refundInFlightRef, setConflicts]);
  return { advance, cancel, refund };
}
