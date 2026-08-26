import type { PortalOrder } from '@platform/domain';

const ACTIVE_ORDER_STATUSES = new Set(['created', 'paid', 'in_progress', 'ready']);

/** Shared wall orders follow server state; standalone fixtures expire by their pickup time. */
export function isUpcomingDemoOrder(
  order: Pick<PortalOrder, 'demoSynced' | 'placedAt' | 'scheduledFor' | 'status'>,
  referenceTime: number,
): boolean {
  if (!ACTIVE_ORDER_STATUSES.has(order.status)) return false;
  if (order.demoSynced) return true;
  return Date.parse(order.scheduledFor ?? order.placedAt) >= referenceTime;
}

/** Guest cancellation mirrors production: collected payment requires staff refunding. */
export function isGuestCancellableDemoOrder(
  order: Pick<PortalOrder, 'status'>,
): boolean {
  return order.status === 'created';
}
