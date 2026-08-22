import {
  mapSquareEvent,
  recordLoyaltyEarn,
  recordPlatformFee,
  reverseLoyaltyEarn,
  verifySquareSignature,
  type SquareEvent,
} from '@platform/engine';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/webhooks/square -- payment.updated, refund.updated,
 * order.updated. Verified against the subscription signature key, mapped to
 * rule 2's states, appended to order_events idempotently on the Square event
 * id (the UNIQUE constraint eats replays), which the trigger projects onto
 * orders and Supabase Realtime fans out to the apps. Refunds also reverse
 * the loyalty earn, proportionally.
 */
export async function POST(request: Request): Promise<Response> {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL;
  const serviceUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!signatureKey || !notificationUrl || !serviceUrl || !serviceKey) {
    return new Response('Webhook is not configured on this deployment.', { status: 501 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-square-hmacsha256-signature');
  if (!verifySquareSignature(signatureKey, notificationUrl, rawBody, signature)) {
    return new Response('Signature rejected', { status: 401 });
  }

  let event: SquareEvent;
  try {
    event = JSON.parse(rawBody) as SquareEvent;
  } catch {
    return new Response('Body is not JSON', { status: 400 });
  }
  const mapped = mapSquareEvent(event);
  if (!mapped) return new Response('No event id', { status: 400 });
  // 200 for events that move nothing: Square retries anything else forever.
  if (mapped.orderStatus === null) return new Response('Recorded, no transition', { status: 200 });

  const db = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });

  // The delivery log migration 0011 describes ("the webhook route writes a
  // row per delivery") was never actually written by this route — only the
  // trigger's stale-transition branch added rows, so the durable record of
  // what Square sent did not exist. It does now, before anything is acted
  // on, so a delivery that later fails still left a trace of arriving.
  await db.from('webhook_events').insert({
    provider: 'square',
    event_id: mapped.squareEventId,
    payload: event as unknown as Record<string, unknown>,
  }).select('id');

  const orderQuery = mapped.squareOrderId
    ? db.from('orders').select('id, brand_id, location_id, customer_id, total_cents, subtotal_cents, stored_value_applied_cents').eq('square_order_id', mapped.squareOrderId)
    : db.from('orders').select('id, brand_id, location_id, customer_id, total_cents, subtotal_cents, stored_value_applied_cents').eq('square_payment_id', mapped.squarePaymentId ?? '');
  const { data: order } = await orderQuery.maybeSingle();
  if (!order) return new Response('Order not known (yet); Square will retry', { status: 404 });

  // `.select()` is what tells a first delivery from a retry: with
  // ignoreDuplicates a replay succeeds and returns no rows. Everything after
  // this point moves money or points, so it must run once per event, not
  // once per delivery — Square retries the same event id freely.
  const { data: written, error: insertError } = await db.from('order_events').upsert(
    {
      brand_id: order.brand_id,
      order_id: order.id,
      type: mapped.orderStatus,
      snapshot: {
        square_event: event.type,
        square_event_id: mapped.squareEventId,
        ...(mapped.refundedCents !== null ? { refunded_cents: mapped.refundedCents } : {}),
      },
      square_event_id: mapped.squareEventId,
      source: 'webhook',
    },
    { onConflict: 'square_event_id', ignoreDuplicates: true },
  ).select('id');
  if (insertError) return new Response(`Event rejected: ${insertError.message}`, { status: 409 });
  const isNewDelivery = (written?.length ?? 0) > 0;
  if (!isNewDelivery) return new Response('Already handled', { status: 200 });

  // A hosted-checkout order earns nothing until the money actually lands:
  // createSquareCheckoutLink deliberately leaves the order 'created', so this
  // is the only place a square_link guest's points and the platform's own fee
  // row are ever written. Without it a card order earned no points at all,
  // and platform_fees stayed empty — which also meant the volume tier could
  // never trip, so the brand paid tier-1 forever (rule 3).
  if (mapped.orderStatus === 'paid') {
    if (order.customer_id) {
      await recordLoyaltyEarn(db, {
        brandId: order.brand_id,
        customerId: order.customer_id,
        orderId: order.id,
        subtotalCents: order.subtotal_cents,
      });
    }
    if (mapped.squarePaymentId) {
      await recordPlatformFee(db, {
        brandId: order.brand_id,
        locationId: order.location_id,
        orderId: order.id,
        squarePaymentId: mapped.squarePaymentId,
        grossCents: order.total_cents - order.stored_value_applied_cents,
      });
    }
  }

  if (mapped.orderStatus === 'refunded') {
    // What Square says came back, not the whole order: a partial refund takes
    // back a proportional share of the earn.
    await reverseLoyaltyEarn(db, {
      brandId: order.brand_id,
      customerId: order.customer_id,
      orderId: order.id,
      orderTotalCents: order.total_cents,
      refundedCents: mapped.refundedCents ?? order.total_cents,
    });
  }

  // Stamped only once the money and points work above has actually run, so
  // an unstamped row is a delivery that arrived and did not finish.
  await db.from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', mapped.squareEventId);

  return new Response('OK', { status: 200 });
}
