import {
  mapSquareEvent,
  recordPlatformFee,
  verifySquareSignature,
  type SquareEvent,
} from '@platform/engine';
import { createClient } from '@supabase/supabase-js';

const DATABASE_TIMEOUT_MS = 8_000;

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(DATABASE_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await fetch(input, { ...init, signal });
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`Supabase returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Supabase request failed');
}

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

  const db = createClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
    global: { fetch: resilientFetch },
  });

  // The delivery log migration 0011 describes ("the webhook route writes a
  // row per delivery") was never actually written by this route — only the
  // trigger's stale-transition branch added rows, so the durable record of
  // what Square sent did not exist. It does now, before anything is acted
  // on, so a delivery that later fails still left a trace of arriving.
  const logged = await db.from('webhook_events').upsert({
    provider: 'square', event_id: mapped.squareEventId,
    payload: event as unknown as Record<string, unknown>,
  }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (logged.error) return new Response('Could not record delivery', { status: 503 });
  const delivery = await db.from('webhook_events')
    .select('processed_at').eq('event_id', mapped.squareEventId)
    .single<{ processed_at: string | null }>();
  if (delivery.error) return new Response('Could not read delivery state', { status: 503 });
  if (delivery.data.processed_at) return new Response('Already handled', { status: 200 });

  // Non-terminal Square updates are still part of the durable delivery log.
  // Mark them complete so a retry is harmless and observability stays honest.
  if (mapped.orderStatus === null) {
    const stamped = await db.from('webhook_events')
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq('event_id', mapped.squareEventId);
    if (stamped.error) return new Response('Delivery stamp failed', { status: 503 });
    return new Response('Recorded, no transition', { status: 200 });
  }

  const orderQuery = mapped.squareOrderId
    ? db.from('orders').select('id, brand_id, location_id, status, total_cents, stored_value_applied_cents').eq('square_order_id', mapped.squareOrderId)
    : db.from('orders').select('id, brand_id, location_id, status, total_cents, stored_value_applied_cents').eq('square_payment_id', mapped.squarePaymentId ?? '');
  const { data: order, error: orderError } = await orderQuery.maybeSingle();
  if (orderError) return new Response('Could not resolve order', { status: 503 });
  if (!order) return new Response('Order not known (yet); Square will retry', { status: 404 });

  if (mapped.orderStatus === 'refunded') {
    if (!mapped.squareRefundId || mapped.refundedCents === null || mapped.refundedCents <= 0) {
      return new Response('Completed refund is missing its id or amount', { status: 422 });
    }
    const processed = await db.rpc('process_square_refund', {
      target_order: order.id,
      square_event: mapped.squareEventId,
      square_refund: mapped.squareRefundId,
      refunded_cents: mapped.refundedCents,
      square_event_type: event.type ?? 'refund.updated',
    });
    if (processed.error) return new Response('Refund processing failed', { status: 409 });
    const stamped = await db.from('webhook_events')
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq('event_id', mapped.squareEventId);
    if (stamped.error) return new Response('Refund processed; delivery stamp failed', { status: 503 });
    return new Response(processed.data ? 'OK' : 'Already handled', { status: 200 });
  }

  // The order-event insert is idempotent. Loyalty follows that event in the
  // same database transaction; the fee remains an external-settlement
  // receipt and has its own unique payment constraint.
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
  if (insertError) return new Response('Event rejected', { status: 409 });
  const isNewDelivery = (written?.length ?? 0) > 0;

  // A hosted-checkout order earns nothing until the money actually lands:
  // createSquareCheckoutLink deliberately leaves the order 'created'. The
  // event trigger grants points atomically; this route records the platform's
  // fee so the volume tier and platform revenue stay complete (rule 3).
  try {
    if (mapped.orderStatus === 'paid') {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : 'Unknown processing failure';
    await db.from('webhook_events').update({ error: detail }).eq('event_id', mapped.squareEventId);
    return new Response('Event processing failed', { status: 503 });
  }

  // Stamped only once the money and points work above has actually run, so
  // an unstamped row is a delivery that arrived and did not finish.
  const stamped = await db.from('webhook_events')
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq('event_id', mapped.squareEventId);
  if (stamped.error) return new Response('Event handled; delivery stamp failed', { status: 503 });

  return new Response(isNewDelivery ? 'OK' : 'Recovered', { status: 200 });
}
