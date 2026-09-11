import type { PortalBundle } from '@platform/domain';

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
