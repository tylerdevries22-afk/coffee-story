import { DEMO_PORTAL } from '@/data/demo';
import type { DemoSyncOrder, DemoSyncSnapshot } from '@platform/api-client';
import {
  fulfillmentDetail,
  fulfillmentLabel,
  type OrderFulfillment,

  OrderableAddOn,
  OrderableItem,
  GiftCard,
  GuestPreferences,
  PortalOrder,
  PortalBundle,
  PortalMessage,
  PortalProfile,
  RewardCatalogItem,
  AppRole} from '@platform/domain';
import { taxCentsFor } from '@platform/domain';

import { TENANT_TAX_JURISDICTIONS } from '@/tenant';

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

export function isValidIsoSlot(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(new Date(value).getTime());
}

export function demoSlotFor(date: string, timeLabel: string): string | null {
  const match = /^(\d{1,2}):(\d{2})\s(AM|PM)$/.exec(timeLabel);
  if (!match) return null;
  const hour = Number(match[1]) % 12 + (match[3] === 'PM' ? 12 : 0);
  const slot = new Date(`${date}T00:00:00`);
  if (Number.isNaN(slot.getTime())) return null;
  slot.setHours(hour, Number(match[2]), 0, 0);
  return slot.toISOString();
}

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

export function redeemDemoReward(
  portal: PortalBundle,
  reward: RewardCatalogItem,
  ledgerId: string,
  earnedAt: string,
): PortalBundle {
  if (reward.pointsCost > portal.rewardAccount.availablePoints) {
    throw new Error('You do not have enough points for this reward.');
  }
  const creditMatch = /\$(\d+)/.exec(reward.name);
  const cashCents = creditMatch ? Number(creditMatch[1]) * 100 : 0;
  return {
    ...portal,
    rewardAccount: {
      ...portal.rewardAccount,
      availablePoints: portal.rewardAccount.availablePoints - reward.pointsCost,
      cashCents: portal.rewardAccount.cashCents + cashCents,
    },
    rewardLedger: [{
      id: ledgerId,
      entryType: 'redemption',
      points: -reward.pointsCost,
      description: `Redeemed ${reward.name}`,
      earnedAt,
      expiresAt: null,
    }, ...portal.rewardLedger],
  };
}

const ACTIVITY_POINTS: Readonly<Record<string, number>> = {
  share_experience: 30,
  refer_friend: 20,
  add_birthday: 5,
  complete_intake: 10,
  google_review: 5,
  enable_reminders: 5,
};

export function completeDemoRewardActivity(
  portal: PortalBundle,
  activityKey: string,
  ledgerId: string,
  earnedAt: string,
): PortalBundle {
  if (portal.rewardActivities.includes(activityKey)) return portal;
  const points = ACTIVITY_POINTS[activityKey];
  if (!points) throw new Error('This activity is not eligible for points.');
  return {
    ...portal,
    rewardActivities: [...portal.rewardActivities, activityKey],
    rewardAccount: {
      ...portal.rewardAccount,
      availablePoints: portal.rewardAccount.availablePoints + points,
      annualPoints: portal.rewardAccount.annualPoints + points,
    },
    rewardLedger: [{
      id: ledgerId,
      entryType: 'activity',
      points,
      description: activityKey.replaceAll('_', ' '),
      earnedAt,
      expiresAt: new Date(new Date(earnedAt).setFullYear(new Date(earnedAt).getFullYear() + 1)).toISOString(),
    }, ...portal.rewardLedger],
  };
}

export function addDemoGift(portal: PortalBundle, gift: GiftCard): PortalBundle {
  return { ...portal, giftCards: [gift, ...portal.giftCards] };
}

export function updateDemoProfile(portal: PortalBundle, profile: PortalProfile): PortalBundle {
  return { ...portal, profile: { ...profile, fullName: profile.fullName.trim(), email: profile.email.trim() } };
}

export function updateDemoIntake(portal: PortalBundle, preferences: GuestPreferences): PortalBundle {
  return { ...portal, preferences };
}

export function addDemoMessage(portal: PortalBundle, message: PortalMessage): PortalBundle {
  return { ...portal, messages: [...(portal.messages ?? []), message] };
}

export function removeDemoPaymentMethod(portal: PortalBundle, methodId: string): PortalBundle {
  const remaining = (portal.paymentMethods ?? []).filter((method) => method.id !== methodId);
  return {
    ...portal,
    paymentMethods: remaining.map((method, index) => ({ ...method, isDefault: index === 0 })),
  };
}

export function setDemoMembershipStatus(
  portal: PortalBundle,
  status: 'active' | 'paused' | 'cancelled',
): PortalBundle {
  return portal.membership ? { ...portal, membership: { ...portal.membership, status } } : portal;
}
