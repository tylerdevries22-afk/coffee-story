import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';

import {
  checkoutGuestLabel
} from '@/features/order/demo-checkout';
import {
  isWindowStillBookable
} from '@platform/domain';


import { placeDemoOrder } from './place-demo-order';
import { placeLiveOrder } from './place-live-order';
import type { SubmittedOrder } from './submitted-order';
import type { OrderState } from './use-order-state';
export function usePlaceOrder(state: OrderState) {
  return useCallback(() => {
    const { isDemo, order, setStep, setOverlay, setPaying, placing, setPayError, guestName, totals, cartSignature } = state;
    if (placing.current) return;
    if (!order.fulfillment || !order.windowValue || order.isEmpty) return;
    const submittedFulfillment = order.fulfillment;
    const submittedWindowValue = order.windowValue;
    const submittedCart = order.cart;
    const submittedTipCents = order.tipCents;
    const submittedTotals = totals;
    const submittedSignature = cartSignature;
    const submittedGuestLabel = checkoutGuestLabel(guestName);
    setPayError(null);

    // Re-checked here, not just in the picker: browsing a sixty-item menu
    // easily outlasts the window that was chosen before it, and an order
    // placed against a lapsed one confirms with a time that has been and gone,
    // then files itself under Past orders.
    if (!isWindowStillBookable(order.windowValue, new Date())) {
      setPayError('That pickup time has passed. Choose a new one from the time pill on the menu.');
      order.setWindowValue(null);
      setOverlay('none');
      setStep('details');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }

    const summary = order.cart.lines
      .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.name}` : line.name))
      .join(', ');

    if (!isDemo && order.fulfillment.mode === 'delivery') {
      setPayError('Delivery ordering is coming to live accounts soon — pickup is ready now.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    placing.current = true;
    setPaying(true);
    const submitted: SubmittedOrder = { submittedFulfillment, submittedWindowValue, submittedCart, submittedTipCents, submittedTotals, submittedSignature, submittedGuestLabel, summary };
    void (isDemo ? placeDemoOrder(state, submitted) : placeLiveOrder(state, submitted));
  }, [state]);
}
