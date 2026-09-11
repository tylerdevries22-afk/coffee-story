import * as Haptics from 'expo-haptics';

import { sizeSuffix } from '@/data/menu-export';
import {
  completeDemoCardOrder
} from '@/features/order/demo-checkout';
import { demoSyncClient } from '@/lib/demo-sync';
import {
  newIdempotencyKey,
  type DemoSyncOrder,
  type PlaceOrderResponse
} from '@platform/api-client';
import type { OrderableItem } from '@platform/domain';
import {
  PICKUP_WINDOW_MINUTES,
  fulfillmentDetail, fulfillmentLabel
} from '@platform/domain';


import type { SubmittedOrder } from './submitted-order';
import type { OrderState } from './use-order-state';

export async function placeDemoOrder(state: OrderState, submitted: SubmittedOrder): Promise<void> {
  const { demo, order, setOverlay, setPaying, placing, setPayError, setRedeemCents, setUseGiftBalance, setPlaced, checkoutKey, cartSignatureRef, pointsEarned } = state;
  const { submittedFulfillment, submittedWindowValue, submittedCart, submittedTipCents, submittedTotals, submittedSignature, submittedGuestLabel, summary } = submitted;
  const syncClient = demoSyncClient;
  try {
    let syncedOrder: PlaceOrderResponse | null = null;
    let sharedOrder: DemoSyncOrder | null = null;
    if (syncClient) {
      checkoutKey.current ??= newIdempotencyKey();
      syncedOrder = await syncClient.placeOrder({
        locationId: 'demo', fulfillmentType: submittedFulfillment.mode,
        scheduledFor: submittedWindowValue,
        lines: submittedCart.lines.map((line) => ({
          itemSlug: line.itemId, sizeSlug: sizeSuffix(line.itemId, line.sizeSlug),
          quantity: line.quantity, modifierSlugs: [...line.optionIds],
          ...(line.note ? { note: line.note } : {}),
          ...(line.packContents ? {
            packContents: line.packContents.map((content) => ({
              itemSlug: content.itemSlug, quantity: content.quantity,
            })),
          } : {}),
        })),
        tipCents: submittedTipCents, maximumTotalCents: submittedTotals.totalCents,
        note: submittedCart.note, tenderType: 'square_card', guestLabel: submittedGuestLabel,
      }, checkoutKey.current);
      sharedOrder = await completeDemoCardOrder(syncClient, syncedOrder);
      syncedOrder = { ...syncedOrder, status: sharedOrder.status };
      checkoutKey.current = null;
    }
    if (syncedOrder && sharedOrder) {
      demo.bookSynced({
        id: syncedOrder.orderId,
        demoSyncSessionId: sharedOrder.sessionId,
        status: sharedOrder.status,
        summary,
        lines: submittedCart.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          options: line.optionSummary ? [line.optionSummary] : [],
          ...(line.packContents ? {
            packContents: line.packContents.map((content) => ({
              name: content.name, quantity: content.quantity,
            })),
          } : {}),
        })),
        fulfillmentType: submittedFulfillment.mode,
        scheduledFor: sharedOrder.scheduledFor,
        placedAt: sharedOrder.placedAt,
        subtotalCents: syncedOrder.subtotalCents,
        taxCents: syncedOrder.taxCents,
        tipCents: syncedOrder.tipCents,
        totalCents: syncedOrder.totalCents,
        note: submittedCart.note,
        ...(submittedGuestLabel ? { guestLabel: submittedGuestLabel } : {}),
        locationLabel: fulfillmentLabel(submittedFulfillment),
        locationDetail: fulfillmentDetail(submittedFulfillment),
      });
    } else {
      const item: OrderableItem = {
        slug: `order-${submittedWindowValue}`, name: summary, category: 'specialty',
        durationMin: PICKUP_WINDOW_MINUTES, priceCents: submittedTotals.totalCents,
        depositCents: submittedTotals.totalCents, description: submittedCart.note || undefined,
      };
      demo.book({ item, addOns: [], placedAt: submittedWindowValue, fulfillment: submittedFulfillment });
    }
    setPlaced({
      summary, totalCents: syncedOrder?.totalCents ?? submittedTotals.totalCents,
      points: pointsEarned, status: syncedOrder?.status ?? 'paid',
      ...(syncedOrder && sharedOrder ? {
        orderId: syncedOrder.orderId,
        demoSynced: true,
        demoSyncSessionId: sharedOrder.sessionId,
      } : {}),
    });
    if (cartSignatureRef.current === submittedSignature) {
      order.clearBag(); order.setTipCents(0); setRedeemCents(0); setUseGiftBalance(false);
    }
    setOverlay('placed');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  } catch (error) {
    setPayError(error instanceof Error ? error.message : 'The shared demo could not place the order.');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  } finally {
    placing.current = false;
    setPaying(false);
  }
}
