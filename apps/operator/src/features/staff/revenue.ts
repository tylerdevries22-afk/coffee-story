import { isRevenueOrderStatus } from '@platform/schema';

export type RevenueOrderRow = {
  status: string;
  total_cents: number;
};

/** Revenue and paid-order count for rows already narrowed to the report window. */
export function staffRevenueMetrics(rows: readonly RevenueOrderRow[]): {
  revenueCents: number;
  orderCount: number;
} {
  const collected = rows.filter((row) => isRevenueOrderStatus(row.status));
  return {
    revenueCents: collected.reduce((sum, row) => sum + row.total_cents, 0),
    orderCount: collected.length,
  };
}
