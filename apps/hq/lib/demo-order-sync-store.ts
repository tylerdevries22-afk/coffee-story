import type { DemoSyncBoardTicket, DemoSyncOrder, DemoSyncSnapshot, PlaceOrderResponse } from '@platform/api-client';
import { canTransition, type OrderChannel, type OrderStatus } from '@platform/schema';

import {
  cloneDemoOrder, demoOrder, DemoSyncError, orderFingerprint, validateOrder,
  type StoredOrder, type StoredTransition,
} from './demo-order-sync-core';

const FIRST_DAILY_NUMBER = 46;

export type DemoSyncStore = ReturnType<typeof createDemoSyncStore>;

/** Project the local broker to the same narrow contract as board_tickets. */
export function demoSyncBoardTickets(snapshot: DemoSyncSnapshot): DemoSyncBoardTicket[] {
  return snapshot.orders.flatMap((order) => (
    order.status === 'paid' || order.status === 'in_progress' || order.status === 'ready'
      ? [{
        id: order.id,
        dailyNumber: order.dailyNumber,
        guestName: order.guestName,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        channel: order.channel,
        updatedAt: order.updatedAt,
      }]
      : []
  ));
}

/** An isolated store factory; the local HQ process owns one instance. */
export function createDemoSyncStore(
  now: () => Date = () => new Date(),
  sessionId = crypto.randomUUID(),
) {
  const byId = new Map<string, StoredOrder>();
  const transitionsByKey = new Map<string, StoredTransition>();
  let revision = 0;
  let nextDailyNumber = FIRST_DAILY_NUMBER;
  return {
    snapshot(): DemoSyncSnapshot {
      return { sessionId, revision, orders: [...byId.values()].map((entry) => cloneDemoOrder(entry.order)) };
    },
    place(input: unknown, idempotencyKey: string, channel: OrderChannel) {
      validateOrder(input);
      const fingerprint = orderFingerprint(input, channel);
      const existing = byId.get(idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new DemoSyncError('idempotency_conflict', 'That checkout key already belongs to another order.');
        }
        return { response: existing.response, replayed: true };
      }
      const order = demoOrder(input, sessionId, idempotencyKey, channel, nextDailyNumber, now());
      nextDailyNumber += 1;
      const response: PlaceOrderResponse = {
        orderId: order.id, status: order.status,
        subtotalCents: Math.max(0, order.totalCents - input.tipCents),
        taxCents: 0, tipCents: input.tipCents, totalCents: order.totalCents,
        dailyNumber: order.dailyNumber,
      };
      byId.set(order.id, { fingerprint, order, response });
      revision += 1;
      return { response, replayed: false };
    },
    transition(
      orderId: string,
      status: OrderStatus,
      channel: OrderChannel,
      idempotencyKey = crypto.randomUUID(),
    ): DemoSyncOrder {
      const fingerprint = JSON.stringify({ orderId, status, channel });
      const replay = transitionsByKey.get(idempotencyKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint) {
          throw new DemoSyncError('idempotency_conflict', 'That transition key belongs to another change.');
        }
        return cloneDemoOrder(replay.response);
      }
      const stored = byId.get(orderId);
      if (!stored) throw new DemoSyncError('not_found', 'That demo order does not exist.');
      if (stored.order.status === status) {
        const response = cloneDemoOrder(stored.order);
        transitionsByKey.set(idempotencyKey, { fingerprint, response });
        return response;
      }
      const guestChannel = channel === 'app' || channel === 'web';
      const guestMove = stored.order.status === 'created'
        && (status === 'paid' || status === 'cancelled');
      if (guestChannel && !guestMove) {
        throw new DemoSyncError(
          'transition_invalid',
          'This order can no longer be changed by the guest. Ask the shop for help.',
        );
      }
      if (!canTransition(stored.order.status, status)) {
        throw new DemoSyncError('transition_invalid', 'That demo order cannot move to the requested status.');
      }
      stored.order = { ...stored.order, status, updatedAt: now().toISOString() };
      stored.response = { ...stored.response, status };
      revision += 1;
      const response = cloneDemoOrder(stored.order);
      transitionsByKey.set(idempotencyKey, { fingerprint, response });
      return response;
    },
  };
}
