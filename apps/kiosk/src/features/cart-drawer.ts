import { formatMoney, orderItemCount, type KioskFlow, type OrderCart } from '@platform/domain';

import type { KioskStepId } from '@/features/step-flow';

/** One spoken label covers the visible count and amount without an icon guess. */
export function cartButtonLabel(cart: OrderCart, totalCents: number): string {
  const count = orderItemCount(cart);
  const noun = count === 1 ? 'item' : 'items';
  return `Cart, ${count} ${noun}, ${formatMoney(totalCents)}`;
}

/** Checkout leaves the drawer at the first tenant-enabled payment step. */
export function checkoutEntryStep(flow: Pick<KioskFlow, 'tip'>): KioskStepId {
  return flow.tip.enabled && flow.tip.presetsCents.length > 0 ? 'tip' : 'pay';
}
