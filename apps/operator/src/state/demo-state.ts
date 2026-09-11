import { DEMO_PORTAL } from '@/data/demo';
import type { DemoSyncOrder, DemoSyncSnapshot } from '@platform/api-client';
import {
  fulfillmentDetail,
  fulfillmentLabel,
  type OrderFulfillment,

  OrderableAddOn,
  OrderableItem,
  PortalOrder,
  PortalBundle,
  AppRole} from '@platform/domain';
import { taxCentsFor } from '@platform/domain';

import { DEMO_TAX_JURISDICTIONS } from '@/data/business';
import { isValidIsoSlot } from './demo-order-updates';

export type DemoOrderInput = {
  id: string;
  item: OrderableItem;
  addOns: OrderableAddOn[];
  placedAt: string;
  fulfillment?: OrderFulfillment;
};

export const DEMO_STATE_VERSION = 5;

function clonePortal(portal: PortalBundle): PortalBundle {
  return JSON.parse(JSON.stringify(portal)) as PortalBundle;
}

export function createInitialDemoPortal(): PortalBundle {
  return migrateDemoPortalState(clonePortal(DEMO_PORTAL));
}

/** Add new persisted preferences without rejecting otherwise valid older demos. */
export function migrateDemoPortalState(portal: PortalBundle): PortalBundle {
  if (
    portal.demoStateVersion === DEMO_STATE_VERSION
    && typeof portal.autoPromptDismissed === 'boolean'
    && (typeof portal.profile.avatarUrl === 'string' || portal.profile.avatarUrl === null)
  ) {
    return portal;
  }
  const orders = portal.demoStateVersion === 4
    ? portal.orders.map((order) => ({
        ...order,
        scheduledFor: order.scheduledFor === null ? null : order.placedAt,
      }))
    : portal.orders;
  return {
    ...portal,
    orders,
    demoStateVersion: DEMO_STATE_VERSION,
    autoPromptDismissed: portal.autoPromptDismissed === true,
    profile: {
      ...portal.profile,
      avatarUrl: typeof portal.profile.avatarUrl === 'string' ? portal.profile.avatarUrl : null,
    },
  };
}

export function dismissDemoSetupAutoPrompt(portal: PortalBundle): PortalBundle {
  if (portal.autoPromptDismissed === true) return portal;
  return {
    ...portal,
    demoStateVersion: DEMO_STATE_VERSION,
    autoPromptDismissed: true,
  };
}

export function setDemoRole(portal: PortalBundle, role: AppRole): PortalBundle {
  return { ...portal, role };
}

export { demoSlotFor, isValidIsoSlot } from './demo-order-updates';

export function addDemoOrder(portal: PortalBundle, input: DemoOrderInput): PortalBundle {
  if (!isValidIsoSlot(input.placedAt)) throw new Error('Choose a valid pickup time.');
  const addOnCents = input.addOns.reduce((total, addOn) => total + addOn.priceCents, 0);
  const subtotalCents = input.item.priceCents + addOnCents;
  const taxCents = taxCentsFor(subtotalCents, DEMO_TAX_JURISDICTIONS);
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


export * from './demo-rewards';
export { cancelDemoOrder, rescheduleDemoOrder, reviewDemoOrder } from './demo-order-updates';
