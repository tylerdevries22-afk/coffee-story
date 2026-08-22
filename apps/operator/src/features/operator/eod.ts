/** End-of-day summary: what the closer reads before locking up. Pure. */
import type { OrderStatus } from '@platform/schema';

export type EodOrder = {
  status: OrderStatus;
  totalCents: number;
  tipCents: number;
  lines: readonly { name: string; quantity: number }[];
};

export type EodSummary = {
  ordersCompleted: number;
  revenueCents: number;
  tipsCents: number;
  averageOrderCents: number;
  refunds: number;
  cancellations: number;
  topItems: readonly { name: string; quantity: number }[];
};

const COUNTED: readonly OrderStatus[] = ['paid', 'in_progress', 'ready', 'picked_up'];

export function endOfDaySummary(orders: readonly EodOrder[], topCount = 5): EodSummary {
  const counted = orders.filter((order) => COUNTED.includes(order.status));
  const revenueCents = counted.reduce((sum, order) => sum + order.totalCents, 0);
  const tipsCents = counted.reduce((sum, order) => sum + order.tipCents, 0);
  const itemTotals = new Map<string, number>();
  for (const order of counted) {
    for (const line of order.lines) {
      itemTotals.set(line.name, (itemTotals.get(line.name) ?? 0) + line.quantity);
    }
  }
  return {
    ordersCompleted: counted.length,
    revenueCents,
    tipsCents,
    averageOrderCents: counted.length === 0 ? 0 : Math.round(revenueCents / counted.length),
    refunds: orders.filter((order) => order.status === 'refunded').length,
    cancellations: orders.filter((order) => order.status === 'cancelled').length,
    topItems: [...itemTotals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topCount)
      .map(([name, quantity]) => ({ name, quantity })),
  };
}
