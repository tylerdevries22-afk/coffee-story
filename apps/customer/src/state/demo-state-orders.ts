import type { DemoSyncOrder, DemoSyncSnapshot } from '@platform/api-client';
import {
  fulfillmentDetail,
  fulfillmentLabel,
  taxCentsFor,
  type PortalBundle,
  type PortalOrder,
} from '@platform/domain';

import { TENANT_TAX_JURISDICTIONS } from '@/tenant';
import { isValidIsoSlot, type DemoOrderInput } from './demo-state-core';

export function addDemoOrder(portal: PortalBundle, input: DemoOrderInput): PortalBundle {
  if (!isValidIsoSlot(input.placedAt)) throw new Error('Choose a valid pickup time.');
  const addOnCents = input.addOns.reduce((total, addOn) => total + addOn.priceCents, 0);
  const subtotalCents = input.item.priceCents + addOnCents;
  const taxCents = taxCentsFor(subtotalCents, TENANT_TAX_JURISDICTIONS);
  const order: PortalOrder = {
    id: input.id,
    summary: input.addOns.length
      ? `${input.item.name} + ${input.addOns.map((addOn) => addOn.name).join(', ')}`
      : input.item.name,
    lines: [
      { name: input.item.name, quantity: 1, unitPriceCents: input.item.priceCents, options: [] },
      ...input.addOns.map((addOn) => ({
        name: addOn.name, quantity: 1, unitPriceCents: addOn.priceCents, options: [],
      })),
    ],
    placedAt: input.placedAt,
    // PortalOrder defines this as the pickup-window start, not its end.
    scheduledFor: input.placedAt,
    status: 'paid',
    fulfillmentType: input.fulfillment?.mode ?? 'pickup',
    subtotalCents,
    taxCents,
    tipCents: 0,
    totalCents: subtotalCents + taxCents,
    note: '',
    locationLabel: input.fulfillment ? fulfillmentLabel(input.fulfillment) : undefined,
    locationDetail: input.fulfillment ? fulfillmentDetail(input.fulfillment) : undefined,
  };
  return { ...portal, orders: [order, ...portal.orders] };
}
/** Persist the broker's identity so history and confirmation follow one order. */
export function addSyncedDemoOrder(portal: PortalBundle, order: PortalOrder): PortalBundle {
  return {
    ...portal,
    orders: [{ ...order, demoSynced: true }, ...portal.orders.filter((entry) => entry.id !== order.id)],
  };
}

/** Reconcile only orders this customer placed; kiosk orders never enter their history. */
export function reconcileSyncedDemoOrders(
  portal: PortalBundle,
  snapshot: Pick<DemoSyncSnapshot, 'sessionId'> & {
    orders: readonly Pick<DemoSyncOrder, 'id' | 'scheduledFor' | 'sessionId' | 'status'>[];
  },
): PortalBundle {
  const byId = new Map(snapshot.orders.map((order) => [order.id, order]));
  let changed = false;
  const orders = portal.orders.map((order) => {
    const next = order.demoSynced ? byId.get(order.id) : undefined;
    if (!next) {
      const belongsToLostSession = order.demoSynced
        && order.status !== 'picked_up'
        && order.status !== 'cancelled'
        && order.status !== 'refunded'
        && order.demoSyncSessionId !== snapshot.sessionId;
      if (!belongsToLostSession) return order;
      changed = true;
      return { ...order, status: 'cancelled' as const };
    }
    if (next.status === order.status
      && next.scheduledFor === order.scheduledFor
      && next.sessionId === order.demoSyncSessionId) return order;
    changed = true;
    return {
      ...order,
      status: next.status,
      scheduledFor: next.scheduledFor,
      demoSyncSessionId: next.sessionId,
    };
  });
  return changed ? { ...portal, orders } : portal;
}

export function cancelDemoOrder(portal: PortalBundle, orderId: string): PortalBundle {
  return {
    ...portal,
    orders: portal.orders.map((order) => (
      order.id === orderId ? { ...order, status: 'cancelled' } : order
    )),
  };
}

/**
 * Records a post-order review on a demo order.
 *
 * Without this the demo branch of `saveVisitReview` persisted nothing while
 * still alerting "Review saved" -- the same fake-success shape already fixed for
 * staff block-time and guest notes. Rating is clamped to the 1-5 range the UI
 * offers so a caller cannot store an out-of-range score.
 */
export function reviewDemoOrder(
  portal: PortalBundle,
  orderId: string,
  rating: number,
  note: string,
  submittedAt: string,
): PortalBundle {
  const clamped = Math.min(Math.max(Math.round(rating), 1), 5);
  return {
    ...portal,
    orders: portal.orders.map((order) => (
      order.id === orderId
        ? { ...order, review: { rating: clamped, note: note.trim(), submittedAt } }
        : order
    )),
  };
}

export function rescheduleDemoOrder(
  portal: PortalBundle,
  orderId: string,
  scheduledFor: string,
): PortalBundle {
  if (!isValidIsoSlot(scheduledFor)) throw new Error('Choose a valid pickup time.');
  return {
    ...portal,
    orders: portal.orders.map((order) => {
      if (order.id !== orderId) return order;
      return {
        ...order,
        scheduledFor,
        status: 'paid',
      };
    }),
  };
}
