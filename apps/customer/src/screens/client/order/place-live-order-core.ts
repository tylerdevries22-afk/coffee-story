import { sizeSuffix } from '@/data/menu-export';
import type { platformApi } from '@/lib/api';

import type { SubmittedOrder } from './submitted-order';
import type { OrderState } from './use-order-state';

type PlaceOrder = NonNullable<typeof platformApi>['placeOrder'];

export type LiveOrderDependencies = {
  configured: boolean;
  loadLocationId: () => Promise<string | null>;
  placeOrder: PlaceOrder;
  createKey: () => string;
  notify: (feedback: 'success' | 'error') => Promise<void>;
};

export async function placeLiveOrderCore(
  state: OrderState,
  submitted: SubmittedOrder,
  dependencies: LiveOrderDependencies,
): Promise<void> {
  const {
    order, setOverlay, setPaying, placing, setPayError, setRedeemCents,
    setUseGiftBalance, setPlaced, checkoutKey, cartSignatureRef, pointsPerDollar,
  } = state;
  const {
    submittedFulfillment, submittedWindowValue, submittedCart,
    submittedTipCents, submittedTotals, submittedSignature, submittedGuestLabel, summary,
  } = submitted;
  try {
    if (!dependencies.configured) {
      throw new Error('Live ordering is not configured in this build.');
    }
    const locationId = await dependencies.loadLocationId();
    if (!locationId) throw new Error('The shop is not accepting orders right now.');
    checkoutKey.current ??= dependencies.createKey();
    const result = await dependencies.placeOrder({
      locationId,
      fulfillmentType: submittedFulfillment.mode === 'pickup' ? 'pickup' : 'delivery',
      scheduledFor: submittedWindowValue,
      lines: submittedCart.lines.map((line) => ({
        itemSlug: line.itemId,
        sizeSlug: sizeSuffix(line.itemId, line.sizeSlug),
        quantity: line.quantity,
        modifierSlugs: [...line.optionIds],
        ...(line.note ? { note: line.note } : {}),
        ...(line.packContents ? {
          packContents: line.packContents.map((content) => ({
            itemSlug: content.itemSlug, quantity: content.quantity,
          })),
        } : {}),
      })),
      tipCents: submittedTipCents,
      maximumTotalCents: submittedTotals.totalCents,
      note: submittedCart.note,
      tenderType: 'pay_at_pickup',
      guestLabel: submittedGuestLabel,
    }, checkoutKey.current);
    checkoutKey.current = null;
    setPlaced({
      summary,
      totalCents: result.totalCents,
      points: Math.floor((result.subtotalCents * pointsPerDollar) / 100),
      status: result.status,
      orderId: result.orderId,
    });
    if (cartSignatureRef.current === submittedSignature) {
      order.clearBag();
      order.setTipCents(0);
      setRedeemCents(0);
      setUseGiftBalance(false);
    }
    setOverlay('placed');
    void dependencies.notify('success').catch(() => undefined);
  } catch (placeError) {
    setPayError(placeError instanceof Error ? placeError.message : 'The order could not be placed.');
    void dependencies.notify('error').catch(() => undefined);
  } finally {
    placing.current = false;
    setPaying(false);
  }
}
