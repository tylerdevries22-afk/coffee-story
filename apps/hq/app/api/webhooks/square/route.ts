import {
  mapSquareEvent,
  verifySquareSignature,
  type SquareEvent,
} from '@platform/engine';
import { createClient } from '@supabase/supabase-js';

import {
  recordWebhookFailure,
  type WebhookFailureStage,
} from '../../../../lib/webhook-diagnostics';
import { squareWebhookLocationMatches } from '../../../../lib/square-webhook-location';

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
  if (!mapped) return new Response('Invalid Square event', { status: 400 });

  const db = createClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
    global: { fetch: resilientFetch },
  });

  const failure = async (stage: WebhookFailureStage, error: unknown, message: string, status: number,
    order?: { id: string; brand_id: string }) => {
    await recordWebhookFailure(db, {
      eventId: mapped.squareEventId, orderId: order?.id, brandId: order?.brand_id, stage,
    }, error);
    return new Response(message, { status });
  };

  // The delivery log migration 0011 describes ("the webhook route writes a
  // row per delivery") was never actually written by this route — only the
  // trigger's stale-transition branch added rows, so the durable record of
  // what Square sent did not exist. It does now, before anything is acted
  // on, so a delivery that later fails still left a trace of arriving.
  const logged = await db.from('webhook_events').upsert({
    provider: 'square', event_id: mapped.squareEventId,
    payload: event as unknown as Record<string, unknown>,
  }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (logged.error) return failure('record_delivery', logged.error, 'Could not record delivery', 503);
  const delivery = await db.from('webhook_events')
    .select('processed_at').eq('event_id', mapped.squareEventId)
    .single<{ processed_at: string | null }>();
  if (delivery.error) return failure('read_delivery', delivery.error, 'Could not read delivery state', 503);
  if (delivery.data.processed_at) return new Response('Already handled', { status: 200 });

  // Non-terminal Square updates are still part of the durable delivery log.
  // Mark them complete so a retry is harmless and observability stays honest.
  if (mapped.orderStatus === null) {
    const stamped = await db.from('webhook_events')
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq('event_id', mapped.squareEventId);
    if (stamped.error) return failure('stamp_delivery', stamped.error, 'Delivery stamp failed', 503);
    return new Response('Recorded, no transition', { status: 200 });
  }

  const orderQuery = mapped.squareOrderId
    ? db.from('orders').select('id, brand_id, location_id, status, total_cents, stored_value_applied_cents').eq('square_order_id', mapped.squareOrderId)
    : db.from('orders').select('id, brand_id, location_id, status, total_cents, stored_value_applied_cents').eq('square_payment_id', mapped.squarePaymentId ?? '');
  const { data: order, error: orderError } = await orderQuery.maybeSingle();
  if (orderError) return failure('resolve_order', orderError, 'Could not resolve order', 503);
  if (!order) return new Response('Order not known (yet); Square will retry', { status: 404 });

  const grossCents = order.total_cents - order.stored_value_applied_cents;
  if (mapped.orderStatus === 'paid' && (
    !Number.isSafeInteger(grossCents) || grossCents < 0
    || !mapped.squareOrderId
    || !mapped.squarePaymentId
    || !mapped.squareLocationId
    || mapped.settledGrossCents !== grossCents
    || mapped.settledFeeCents === undefined || mapped.settledFeeCents > grossCents
  )) return new Response('Invalid payment settlement amounts', { status: 422 });
  if (mapped.orderStatus === 'paid') {
    try {
      if (!await squareWebhookLocationMatches(db, order, mapped.squareLocationId as string)) {
        return new Response('Invalid payment settlement location', { status: 422 });
      }
    } catch (error) {
      return failure('resolve_order', error, 'Could not verify payment location', 503, order);
    }
  }

  // Leave money settled on a locally cancelled order for reconciliation.
  if (mapped.orderStatus === 'paid' && order.status === 'cancelled') {
    return failure('order_event', new Error('Square settled a cancelled order'),
      'Cancelled order requires payment reconciliation', 409, order);
  }

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
    if (processed.error) return failure('refund', processed.error, 'Refund processing failed', 409, order);
    const stamped = await db.from('webhook_events')
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq('event_id', mapped.squareEventId);
    if (stamped.error) return failure('stamp_delivery', stamped.error, 'Refund processed; delivery stamp failed', 503, order);
    return new Response(processed.data ? 'OK' : 'Already handled', { status: 200 });
  }

  let isNewDelivery = false;
  if (mapped.orderStatus === 'paid') {
    // Payment identity, paid transition, loyalty side effects, and the fee
    // receipt commit together. Refunds resolve through the persisted payment
    // id, so none of this settlement may be acknowledged in isolation.
    const settled = await db.rpc('record_square_payment_settlement', {
      target_order: order.id,
      square_event: mapped.squareEventId,
      square_order: mapped.squareOrderId,
      square_payment: mapped.squarePaymentId,
      settled_fee_cents: mapped.settledFeeCents,
      square_event_type: event.type ?? 'payment.updated',
    });
    if (settled.error) {
      return failure('platform_fee', settled.error, 'Payment settlement failed', 503, order);
    }
    isNewDelivery = settled.data === true;
  } else {
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
    if (insertError) return failure('order_event', insertError, 'Event rejected', 409, order);
    isNewDelivery = (written?.length ?? 0) > 0;
  }

  // Stamped only once the money and points work above has actually run, so
  // an unstamped row is a delivery that arrived and did not finish.
  const stamped = await db.from('webhook_events')
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq('event_id', mapped.squareEventId);
  if (stamped.error) return failure('stamp_delivery', stamped.error, 'Event handled; delivery stamp failed', 503, order);

  return new Response(isNewDelivery ? 'OK' : 'Recovered', { status: 200 });
}
