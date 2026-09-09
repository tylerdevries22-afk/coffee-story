begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
set local time zone 'UTC';
select plan(17);

insert into public.brands (id, slug, name) values
  ('f7766666-6666-4666-8666-666666666666',
   'fee-remediation-webhook', 'Fee Remediation Webhook');
insert into public.locations (id, brand_id, name, timezone) values
  ('f7760000-0000-4000-8000-000000000001',
   'f7766666-6666-4666-8666-666666666666', 'Remediation Webhook', 'UTC');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents,
  total_cents, square_order_id
)
select ('f7760000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f7766666-6666-4666-8666-666666666666',
  'f7760000-0000-4000-8000-000000000001', 'created', 'square_card',
  1000, 1000, 'webhook-order-' || n from generate_series(1, 2) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() - interval '1 second', id from public.orders
where brand_id = 'f7766666-6666-4666-8666-666666666666';

create temporary table cleanup as
select * from public.claim_due_square_card_quotes(now(), 50);
select is((select count(*) from cleanup), 2::bigint,
  'cleanup leases both ambiguous card attempts');
select is(public.expire_square_card_quote(
  'f7760000-0000-4000-8000-000000000001',
  (select claim_generation from cleanup where order_id =
    'f7760000-0000-4000-8000-000000000001'),
  'webhook-order-1', 1, 'CANCELED', null, null), true,
  'first provider-cancelled attempt expires');
select is(public.expire_square_card_quote(
  'f7760000-0000-4000-8000-000000000002',
  (select claim_generation from cleanup where order_id =
    'f7760000-0000-4000-8000-000000000002'),
  'webhook-order-2', 2, 'CANCELED', null, null), true,
  'second provider-cancelled attempt expires');
select is(public.record_square_payment_settlement(
  'f7760000-0000-4000-8000-000000000001', 'webhook-settlement-1',
  'webhook-order-1', 'webhook-payment-1', 30, 'payment.updated'), true,
  'first delayed charge is durably recorded and queued');
select is(public.record_square_payment_settlement(
  'f7760000-0000-4000-8000-000000000002', 'webhook-settlement-2',
  'webhook-order-2', 'webhook-payment-2', 30, 'payment.updated'), true,
  'second delayed charge is durably recorded and queued');

create temporary table remediation_claims as
select * from public.claim_due_square_payment_remediations(now(), 50);
select is((select count(*) from remediation_claims), 2::bigint,
  'refund worker leases both durable full-refund intents');
select is(public.process_square_refund(
  'f7760000-0000-4000-8000-000000000001', 'webhook-refund-event-1',
  'webhook-refund-1', 1000, 'refund.updated'), true,
  'completed refund webhook can win the active worker lease');
select results_eq($q$select status, square_refund_id, provider_refund_status,
    provider_refund_payment_id, provider_refund_amount_cents,
    provider_refund_currency from app_private.square_payment_remediation_outbox
  where order_id = 'f7760000-0000-4000-8000-000000000001'$q$,
  $$values ('completed'::text, 'webhook-refund-1'::text, 'COMPLETED'::text,
    'webhook-payment-1'::text, 1000::bigint, 'USD'::text)$$,
  'webhook completion records the exact immutable refund proof');
select results_eq($q$select type::text, refund_cents,
    snapshot ->> 'square_payment_id' from public.order_events
  where square_refund_id = 'webhook-refund-1'$q$,
  $$values ('cancelled'::text, 1000::bigint, 'webhook-payment-1'::text)$$,
  'webhook completion writes same-state cancelled accounting');
select is(public.process_square_refund(
  'f7760000-0000-4000-8000-000000000001', 'webhook-refund-event-1',
  'webhook-refund-1', 1000, 'refund.updated'), false,
  'completed refund webhook replay is a no-op');
select is(public.finalize_square_payment_remediation(
  'f7760000-0000-4000-8000-000000000001',
  (select claim_generation from remediation_claims where order_id =
    'f7760000-0000-4000-8000-000000000001'),
  'webhook-refund-1', 'COMPLETED', 'webhook-payment-1', 1000, 'USD'), true,
  'worker response-loss replay sees the webhook-completed fingerprint');

select is(public.finalize_square_payment_remediation(
  'f7760000-0000-4000-8000-000000000002',
  (select claim_generation from remediation_claims where order_id =
    'f7760000-0000-4000-8000-000000000002'),
  'webhook-refund-2', 'COMPLETED', 'wrong-payment', 1000, 'USD'), false,
  'finalizer rejects the wrong provider payment identity');
select is(public.finalize_square_payment_remediation(
  'f7760000-0000-4000-8000-000000000002',
  (select claim_generation from remediation_claims where order_id =
    'f7760000-0000-4000-8000-000000000002'),
  'webhook-refund-2', 'COMPLETED', 'webhook-payment-2', 999, 'USD'), false,
  'finalizer rejects a partial refund amount');
select throws_ok($q$select public.finalize_square_payment_remediation(
  'f7760000-0000-4000-8000-000000000002',
  (select claim_generation from remediation_claims where order_id =
    'f7760000-0000-4000-8000-000000000002'),
  'webhook-refund-2', 'COMPLETED', 'webhook-payment-2', 1000, 'CAD')$q$,
  'P0001', 'invalid Square payment remediation result',
  'finalizer rejects a non-USD provider proof');
select is(public.finalize_square_payment_remediation(
  'f7760000-0000-4000-8000-000000000002',
  (select claim_generation from remediation_claims where order_id =
    'f7760000-0000-4000-8000-000000000002'),
  'webhook-refund-2', 'PENDING', 'webhook-payment-2', 1000, 'USD'), true,
  'pending provider refund is retained for reconciliation');
select is(public.process_square_refund(
  'f7760000-0000-4000-8000-000000000002', 'webhook-refund-event-2',
  'webhook-refund-2', 1000, 'refund.updated'), true,
  'later completed webhook reconciles the submitted refund');
select is((select count(*) from app_private.square_payment_remediation_outbox
  where status = 'completed'), 2::bigint,
  'both completed remediations remain durable');

select * from finish();
rollback;
