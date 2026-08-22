/**
 * Exercises the whole money path against the Square sandbox:
 * connect -> order -> pay (with app_fee_money) -> webhook mapping -> ready ->
 * refund. Run it before trusting a deploy.
 *
 * Needs, in the environment (never in the repo):
 *   SQUARE_APP_ID / SQUARE_APP_SECRET   (sandbox application)
 *   SQUARE_SANDBOX_ACCESS_TOKEN         (sandbox seller test account token)
 *   SQUARE_SANDBOX_LOCATION_ID          (that account's location)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (a database with the schema applied)
 *   SQUARE_TOKEN_KEY                    (32 bytes base64)
 *
 *   npx tsx scripts/square-sandbox.ts
 */
import { createClient } from '@supabase/supabase-js';

import {
  buildSquareLines,
  computeAppFeeCents,
  createSquareOrder,
  createSquarePayment,
  mapSquareEvent,
  refundSquarePayment,
  squareConfigFromEnv,
} from '@platform/engine';

const REQUIRED = [
  'SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_SANDBOX_ACCESS_TOKEN',
  'SQUARE_SANDBOX_LOCATION_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`square-sandbox: cannot run without ${missing.join(', ')}.`);
  console.error('This script talks to the real Square sandbox and a real database; there is no offline mode.');
  process.exit(1);
}

const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN!;
const squareLocationId = process.env.SQUARE_SANDBOX_LOCATION_ID!;

async function run() {
  const config = squareConfigFromEnv();
  if (config.env !== 'sandbox') {
    throw new Error('Refusing to run the exercise against production Square. Unset SQUARE_ENV.');
  }
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log('1/6 seeding a brand + location to hang the order on…');
  const { data: brand, error: brandError } = await db
    .from('brands').upsert({ slug: 'sandbox-exercise', name: 'Sandbox Exercise' }, { onConflict: 'slug' })
    .select('id, fee_bps, fee_bps_tier2, tier_threshold_cents').single();
  if (brandError) throw brandError;
  const { data: location } = await db
    .from('locations').select('id').eq('brand_id', brand.id).eq('name', 'Sandbox').maybeSingle();
  let locationId = location?.id as string | undefined;
  if (!locationId) {
    const { data: created, error } = await db
      .from('locations')
      .insert({ brand_id: brand.id, name: 'Sandbox', timezone: 'America/Denver' })
      .select('id').single();
    if (error) throw error;
    locationId = created.id;
  }

  console.log('2/6 creating the order (DB row + Square order)…');
  const lines = [{ itemId: 'cortado', name: 'Cortado', quantity: 1, unitPriceCents: 450, options: [] as string[] }];
  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      brand_id: brand.id, location_id: locationId, total_cents: 450, subtotal_cents: 450,
      totals: { lines }, note: 'sandbox exercise',
    })
    .select('id').single();
  if (orderError) throw orderError;
  const squareOrder = await createSquareOrder(config, token, {
    squareLocationId, referenceId: order.id, lines: buildSquareLines(lines),
  });
  const squareOrderId = squareOrder.order?.id;
  if (!squareOrderId) throw new Error('No Square order id came back.');
  console.log(`   square order ${squareOrderId}`);

  console.log('3/6 paying with the sandbox test card (cnon:card-nonce-ok), app fee attached…');
  const fee = computeAppFeeCents(
    { feeBps: brand.fee_bps, feeBpsTier2: brand.fee_bps_tier2, tierThresholdCents: brand.tier_threshold_cents },
    0,
    450,
  );
  const payment = await createSquarePayment(config, token, {
    sourceId: 'cnon:card-nonce-ok',
    squareOrderId,
    referenceId: order.id,
    amountCents: 450,
    tipCents: 0,
    appFeeCents: fee.feeCents,
  });
  const paymentId = payment.payment?.id;
  if (!paymentId) throw new Error('No Square payment id came back.');
  console.log(`   payment ${paymentId} status ${payment.payment?.status}, fee ${fee.feeCents}c`);
  await db.from('orders').update({ square_order_id: squareOrderId, square_payment_id: paymentId }).eq('id', order.id);

  console.log('4/6 asserting the webhook mapping on a synthetic payment.updated…');
  const mapped = mapSquareEvent({
    event_id: `exercise-${order.id}`,
    type: 'payment.updated',
    data: { object: { payment: { id: paymentId, status: 'COMPLETED', order_id: squareOrderId } } },
  });
  if (mapped?.orderStatus !== 'paid') throw new Error('Webhook mapping did not produce paid.');
  const { error: paidError } = await db.from('order_events').upsert(
    {
      brand_id: brand.id, order_id: order.id, type: 'paid',
      square_event_id: mapped.squareEventId, source: 'webhook',
      snapshot: { exercise: true },
    },
    { onConflict: 'square_event_id', ignoreDuplicates: true },
  );
  if (paidError) throw paidError;

  console.log('5/6 walking the board: in_progress -> ready…');
  for (const status of ['in_progress', 'ready'] as const) {
    const { error } = await db.from('order_events').insert({
      brand_id: brand.id, order_id: order.id, type: status, source: 'operator', snapshot: {},
    });
    if (error) throw error;
  }

  console.log('6/6 refunding in full…');
  const refund = await refundSquarePayment(config, token, {
    paymentId, amountCents: 450, referenceId: order.id, reason: 'sandbox exercise',
  });
  console.log(`   refund ${refund.refund?.id} status ${refund.refund?.status}`);
  const { error: refundEventError } = await db.from('order_events').insert({
    brand_id: brand.id, order_id: order.id, type: 'refunded', source: 'webhook', snapshot: {},
    square_event_id: `exercise-refund-${order.id}`,
  });
  if (refundEventError) throw refundEventError;

  const { data: finalOrder } = await db.from('orders').select('status').eq('id', order.id).single();
  console.log(`done: order ${order.id} finished as ${finalOrder?.status}`);
  if (finalOrder?.status !== 'refunded') throw new Error('The trigger did not land the order on refunded.');
}

run().catch((error) => {
  console.error('square-sandbox failed:', error?.message ?? error);
  process.exit(1);
});
