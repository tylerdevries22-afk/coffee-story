import { DEMO_PORTAL } from '@/data/demo';
import type {
  AppRole,
  OrderableAddOn,
  OrderableItem,
  OrderFulfillment,
  PortalBundle,
} from '@platform/domain';

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
