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
import { appendConflict, type OperatorConflict } from '@/state/operator-conflicts';
import type { OperatorLocation } from '@/state/operator-locations';
import type { ActionOutcome } from '@/state/operator-store-types';

type Options = {
  flushQueue: (status: ReadonlyMap<string, OrderStatus>) => Promise<void>;
  live: boolean; location: OperatorLocation; locationReady: boolean;
  ordersRef: MutableRefObject<BoardOrder[]>; queueRef: MutableRefObject<QueuedTransition[]>;
  reconcileDemoSync: () => Promise<void>; refundInFlightRef: MutableRefObject<Set<string>>;
  setConflicts: Dispatch<SetStateAction<OperatorConflict[]>>;
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
  const cancel = useCallback((orderId: string): Promise<ActionOutcome> => {
    const order = ordersRef.current.find((candidate) => candidate.id === orderId);
    if (!order || !canCancelWithoutRefund(order)) {
      const message = 'Only unpaid pay-at-pickup orders can be cancelled directly. Refund a paid card order instead.';
      setConflicts((existing) => appendConflict(existing, orderId, message));
      return Promise.resolve({ ok: false, message });
    }
    applyTransition(orderId, 'cancelled');
    return Promise.resolve({ ok: true });
  }, [applyTransition, ordersRef, setConflicts]);
  const refund = useCallback((orderId: string, amountCents: number | 'full'): Promise<ActionOutcome> => {
    if (!live) { applyTransition(orderId, 'refunded'); return Promise.resolve({ ok: true }); }
    const api = platformApi;
    if (!api) {
      const message = 'This device has no payments connection configured. Nothing was changed.';
      setConflicts((existing) => appendConflict(existing, orderId, message));
      return Promise.resolve({ ok: false, message });
    }
    if (refundInFlightRef.current.has(orderId)) {
      return Promise.resolve({ ok: false, message: 'A refund for this order is already in progress. Wait for it to finish.' });
    }
    refundInFlightRef.current.add(orderId);
    return runRefundAttempt(AsyncStorage, { orderId, amountCents },
      (idempotencyKey) => api.refundOrder({ orderId, amountCents }, idempotencyKey))
      .then((): ActionOutcome => ({ ok: true }))
      .catch((error: unknown): ActionOutcome => {
        const conclusive = refundFailureIsConclusive(error);
        const message = error instanceof RefundAttemptError ? error.message : error instanceof Error
          ? conclusive ? `${error.message} No refund was submitted.`
            : `${error.message} The outcome is uncertain; retry the same amount to safely check it.`
          : 'The refund outcome is uncertain; retry the same amount to safely check it.';
        setConflicts((existing) => appendConflict(existing, orderId, message));
        return { ok: false, message };
      }).finally(() => { refundInFlightRef.current.delete(orderId); });
  }, [applyTransition, live, refundInFlightRef, setConflicts]);
  return { advance, cancel, refund };
}
