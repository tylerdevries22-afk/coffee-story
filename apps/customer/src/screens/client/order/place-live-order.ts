import * as Haptics from 'expo-haptics';

import { sizeSuffix } from '@/data/menu-export';
import { platformApi } from '@/lib/api';
import { liveOrderContext } from '@/lib/live-portal';
import { supabase } from '@/lib/supabase';
import {
  newIdempotencyKey
} from '@platform/api-client';


import type { SubmittedOrder } from './submitted-order';
import type { OrderState } from './use-order-state';

export async function placeLiveOrder(state: OrderState, submitted: SubmittedOrder): Promise<void> {
  const { order, setOverlay, setPaying, placing, setPayError, setRedeemCents, setUseGiftBalance, setPlaced, checkoutKey, cartSignatureRef } = state;
  const { submittedFulfillment, submittedWindowValue, submittedCart, submittedTipCents, submittedSignature, summary } = submitted;
  const fulfillment = submittedFulfillment;
  try {
    if (!supabase || !platformApi) {
      throw new Error('Live ordering is not configured in this build.');
    }
    const context = await liveOrderContext(supabase);
    if (!context) throw new Error('The shop is not accepting orders right now.');
    checkoutKey.current ??= newIdempotencyKey();
    const result = await platformApi.placeOrder({
      locationId: context.locationId,
      fulfillmentType: fulfillment.mode === 'pickup' ? 'pickup' : 'delivery',
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
      note: submittedCart.note,
      tenderType: 'pay_at_pickup',
    }, checkoutKey.current);
    checkoutKey.current = null;
    setPlaced({
      summary,
      // The server's math is the order's truth; the client never
      // renders its own totals for a live order.
      totalCents: result.totalCents,
      points: Math.floor(result.subtotalCents / 10),
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
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  } catch (placeError) {
    setPayError(placeError instanceof Error ? placeError.message : 'The order could not be placed.');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  } finally {
    placing.current = false;
    setPaying(false);
  }
}
