import { OrderError, type CreateOrderDeps } from './types';

/** Cancellable by the guest only before any tender has been collected. */
const GUEST_CANCELLABLE: ReadonlySet<string> = new Set(['created']);

export type CancelOrderInput = {
  orderId: string;
  /** The guest's customer row. The order must be theirs. */
  customerId: string;
  actorUserId: string | null;
  reason: string;
};

/**
 * A guest calling off their own order.
 *
 * The state machine has always allowed created/paid -> cancelled and the
 * event table has always allowed a 'customer' source, but nothing wrote one:
 * a guest who ordered by mistake had no way out, and the shop got a drink
 * ticket nobody would collect. This is the missing writer.
 *
 * Two limits, both about honesty rather than permission. Once the barista
 * hits Start, the drink exists — that cancellation is a conversation at the
 * counter, not a button. And an order whose card already charged needs the
 * money returned, which only staff can do through Square, so it says so
 * instead of quietly cancelling and keeping the payment.
 */
export async function cancelOrder(
  deps: CreateOrderDeps,
  input: CancelOrderInput,
): Promise<{ orderId: string; status: string; alreadyCancelled: boolean }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, customer_id, status, total_cents, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      customer_id: string | null;
      status: string;
      total_cents: number;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  // Same answer for "no such order" and "not yours": a guest must not be able
  // to probe which order ids exist.
  if (!order || order.customer_id !== input.customerId) {
    throw new OrderError('invalid_request', 'That order does not exist.');
  }
  if (order.status === 'cancelled') {
    return { orderId: order.id, status: 'cancelled', alreadyCancelled: true };
  }
  if (order.square_payment_id) {
    throw new OrderError('cancel_unavailable',
      'This order is already paid by card. Ask the shop to cancel and refund it.');
  }
  if (!GUEST_CANCELLABLE.has(order.status)) {
    throw new OrderError('cancel_unavailable',
      order.status === 'in_progress' || order.status === 'ready'
        ? 'The shop has already started this order — talk to them at the counter.'
        : `This order is ${order.status} and can no longer be cancelled.`);
  }

  const { error } = await deps.db.from('order_events').insert({
    brand_id: order.brand_id,
    order_id: order.id,
    type: 'cancelled',
    snapshot: { reason: input.reason, cancelled_by: 'guest' },
    actor_user_id: input.actorUserId,
    source: 'customer',
  });
  if (error) {
    // The barista started it between the read and the write: the trigger
    // refuses the transition. Only that gets the counter sentence — every
    // other failure is an infrastructure problem, and claiming the shop
    // started an order it did not is both a lie to the guest and a 409 that
    // hides a 500 from whoever is watching the logs.
    if (/illegal order transition/i.test(error.message)) {
      throw new OrderError('cancel_unavailable',
        'The shop started this order just now — talk to them at the counter.');
    }
    throw error;
  }

  // The event trigger reverses any prior earn in this same transaction. A
  // created pay-at-pickup order has no earn to reverse until staff collects.
  return { orderId: order.id, status: 'cancelled', alreadyCancelled: false };
}
