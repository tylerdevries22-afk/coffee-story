import type {
  DemoSyncClient,
  DemoSyncOrder,
  DemoSyncSnapshot,
  PlaceOrderResponse,
} from '@platform/api-client';
import { guestLabelFor, type OrderCart } from '@platform/domain';
import { isTerminal, type OrderStatus } from '@platform/schema';

type DemoOrderRecoveryClient = Pick<DemoSyncClient, 'orders' | 'transition'>;

/** Canonical when valid; otherwise unchanged so the broker can reject it. */
export function checkoutGuestLabel(value: string): string {
  return guestLabelFor(value) ?? value;
}

/** Everything that can change the order request sharing one checkout key. */
export function checkoutAttemptSignature(input: {
  cart: OrderCart;
  deliveryFeeCents: number;
  fulfillmentMode: string | null;
  guestName: string;
  redeemCents: number;
  tipCents: number;
  windowValue: string | null;
}): string {
  return JSON.stringify([
    input.cart.lines.map((line) => [
      line.id,
      line.quantity,
      line.unitPriceCents,
      line.note ?? null,
      line.packContents?.map((content) => [content.itemSlug, content.quantity]) ?? null,
    ]),
    input.cart.note,
    input.tipCents,
    input.deliveryFeeCents,
    input.redeemCents,
    input.fulfillmentMode,
    input.windowValue,
    checkoutGuestLabel(input.guestName),
  ]);
}

/** Complete a new card order or recover an idempotent replay already advanced by staff. */
export async function completeDemoCardOrder(
  client: DemoOrderRecoveryClient,
  placed: PlaceOrderResponse,
): Promise<DemoSyncOrder> {
  if (placed.status === 'created') return client.transition(placed.orderId, 'paid');
  const snapshot = await client.orders();
  const recovered = snapshot.orders.find((order) => order.id === placed.orderId);
  if (!recovered) throw new Error('The shared demo could not recover the placed order.');
  if (isTerminal(recovered.status)) {
    throw new Error('This checkout was already cancelled or refunded. No new payment was taken.');
  }
  return recovered;
}

/** Retire an open confirmation when the ephemeral broker that owned it restarts. */
export function demoConfirmationStatus(
  current: OrderStatus,
  orderId: string,
  sessionId: string,
  snapshot: DemoSyncSnapshot,
): OrderStatus {
  const order = snapshot.orders.find((entry) => (
    entry.id === orderId && entry.sessionId === sessionId
  ));
  if (order) return order.status;
  return snapshot.sessionId === sessionId ? current : 'cancelled';
}
