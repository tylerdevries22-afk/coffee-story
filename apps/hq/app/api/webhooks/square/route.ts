import {
  mapSquareEvent,
  pointsToReverse,
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

  const orderQuery = mapped.squareOrderId
    ? db.from('orders').select('id, brand_id, customer_id, total_cents, subtotal_cents').eq('square_order_id', mapped.squareOrderId)
    : db.from('orders').select('id, brand_id, customer_id, total_cents, subtotal_cents').eq('square_payment_id', mapped.squarePaymentId ?? '');
  const { data: order } = await orderQuery.maybeSingle();
  if (!order) return new Response('Order not known (yet); Square will retry', { status: 404 });

  const { error: insertError } = await db.from('order_events').upsert(
    {
      brand_id: order.brand_id,
      order_id: order.id,
      type: mapped.orderStatus,
      snapshot: { square_event: event.type, square_event_id: mapped.squareEventId },
      square_event_id: mapped.squareEventId,
      source: 'webhook',
    },
    { onConflict: 'square_event_id', ignoreDuplicates: true },
  );
  if (insertError) return new Response(`Event rejected: ${insertError.message}`, { status: 409 });

  if (mapped.orderStatus === 'refunded' && order.customer_id) {
    const { data: account } = await db
      .from('loyalty_accounts')
      .select('id, points_balance')
      .eq('customer_id', order.customer_id)
      .maybeSingle();
    const { data: earnEvent } = await db
      .from('loyalty_events')
      .select('points')
      .eq('order_id', order.id)
      .eq('type', 'earn')
      .maybeSingle();
    if (account && earnEvent) {
      const reverse = pointsToReverse(earnEvent.points, order.total_cents, order.total_cents);
      if (reverse > 0) {
        await db.from('loyalty_events').insert({
          brand_id: order.brand_id,
          account_id: account.id,
          order_id: order.id,
          type: 'reverse',
          points: -reverse,
        });
        await db.from('loyalty_accounts')
          .update({ points_balance: Math.max(0, account.points_balance - reverse) })
          .eq('id', account.id);
      }
    }
  }

  return new Response('OK', { status: 200 });
}
