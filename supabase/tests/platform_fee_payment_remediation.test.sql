begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
\ir helpers/platform_fee_remediation.sql
select plan(43);

insert into public.brands (id, slug, name) values
  ('f7777777-7777-4777-8777-777777777777', 'fee-remediation', 'Fee Remediation');
insert into public.locations (id, brand_id, name) values
  ('f7770000-0000-4000-8000-000000000001',
   'f7777777-7777-4777-8777-777777777777', 'Remediation Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_order_id
)
select ('f7770000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f7777777-7777-4777-8777-777777777777',
  'f7770000-0000-4000-8000-000000000001', 'created', 'square_card',
  1000, 1000, 'remediation-order-' || n
from generate_series(1, 3) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() - interval '1 second', id
from public.orders where brand_id = 'f7777777-7777-4777-8777-777777777777';

create temporary table cleanup_claims as
select * from public.claim_due_square_card_quotes(now(), 50);
select is((select count(*) from cleanup_claims), 3::bigint,
  'cleanup leases each expired attempt');
select is(public.expire_square_card_quote(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from cleanup_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'),
  'remediation-order-1', 4, 'CANCELED', null, null), true,
  'provider-cancelled attempt one expires');
select is(public.expire_square_card_quote(
  'f7770000-0000-4000-8000-000000000002',
  (select claim_generation from cleanup_claims where order_id =
    'f7770000-0000-4000-8000-000000000002'),
  'remediation-order-2', 5, 'CANCELED', null, null), true,
  'provider-cancelled attempt two expires');
select is(public.expire_square_card_quote(
  'f7770000-0000-4000-8000-000000000003',
  (select claim_generation from cleanup_claims where order_id =
    'f7770000-0000-4000-8000-000000000003'),
  'remediation-order-3', 6, 'CANCELED', null, null), true,
  'provider-cancelled attempt three expires');

select is(public.record_square_payment_settlement(
  'f7770000-0000-4000-8000-000000000001', 'remediation-event-1',
  'remediation-order-1', 'remediation-payment-1', 30, 'payment.updated'), true,
  'late completion one is recorded');
select is(public.record_square_payment_settlement(
  'f7770000-0000-4000-8000-000000000002', 'remediation-event-2',
  'remediation-order-2', 'remediation-payment-2', 30, 'payment.updated'), true,
  'late completion two is recorded');
select is(public.record_square_payment_settlement(
  'f7770000-0000-4000-8000-000000000003', 'remediation-event-3',
  'remediation-order-3', 'remediation-payment-3', 30, 'payment.updated'), true,
  'late completion three is recorded');
select ok((select bool_and(status = 'cancelled') from public.orders
  where brand_id = 'f7777777-7777-4777-8777-777777777777'),
  'late settlement leaves locally cancelled orders cancelled');
select is((select count(*) from public.platform_fees where brand_id =
  'f7777777-7777-4777-8777-777777777777'), 3::bigint,
  'late settlements retain exact fee receipts');
select is((select count(*) from public.order_events where square_event_id like
  'remediation-event-%'), 3::bigint, 'late settlement events remain durable');
select is((select count(*) from app_private.square_payment_remediation_outbox),
  3::bigint, 'late settlements atomically enqueue full refunds');
select is(public.record_square_payment_settlement(
  'f7770000-0000-4000-8000-000000000001', 'remediation-event-1',
  'remediation-order-1', 'remediation-payment-1', 30, 'payment.updated'), false,
  'exact late settlement replay is a no-op');
select results_eq($q$select square_payment_id, refund_amount_cents,
    refund_request_key, status from app_private.square_payment_remediation_outbox
  where order_id = 'f7770000-0000-4000-8000-000000000001'$q$,
  $$values ('remediation-payment-1'::text, 1000::bigint,
    'f7770000-0000-4000-8000-000000000001'::uuid, 'pending'::text)$$,
  'queued refund identity and amount are deterministic');

create temporary table first_claims as
select * from public.claim_due_square_payment_remediations(now(), 50);
select is((select count(*) from first_claims), 3::bigint,
  'worker claims every due remediation');
select results_eq($q$select square_order_id, square_payment_id,
    refund_amount_cents, refund_request_key, square_refund_id,
    provider_refund_status, attempt_count from first_claims where order_id =
      'f7770000-0000-4000-8000-000000000001'$q$,
  $$values ('remediation-order-1'::text, 'remediation-payment-1'::text,
    1000::bigint, 'f7770000-0000-4000-8000-000000000001'::uuid,
    null::text, null::text, 1::integer)$$, 'claim exposes the exact refund intent');
select is((select count(*) from public.claim_due_square_payment_remediations(
  now(), 50)), 0::bigint, 'live remediation leases are not stolen');
select throws_ok('select * from public.claim_due_square_payment_remediations(now(), 51)',
  'P0001', 'invalid Square payment remediation claim inputs',
  'oversized remediation claims are rejected');
select throws_ok($q$select pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000003',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000003'), 'refund-three', null)$q$,
  'P0001', 'invalid Square payment remediation result',
  'nullable provider refund status is rejected');
select is((select status from app_private.square_payment_remediation_outbox
  where order_id = 'f7770000-0000-4000-8000-000000000003'), 'processing',
  'invalid finalization preserves its live lease');

select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'), 'refund-one', 'PENDING'), true,
  'pending provider refund identity is retained');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'), 'refund-one', 'PENDING'), true,
  'pending finalizer response-loss replay is idempotent');
select results_eq($q$select status, square_refund_id, provider_refund_status
  from app_private.square_payment_remediation_outbox where order_id =
    'f7770000-0000-4000-8000-000000000001'$q$,
  $$values ('submitted'::text, 'refund-one'::text, 'PENDING'::text)$$,
  'pending refund waits for exact-key reconciliation');
select is((select count(*) from public.claim_due_square_payment_remediations(
  now(), 50)), 0::bigint, 'pending and processing leases wait five minutes');

select is(public.fail_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000002',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000002'),
  'provider_unavailable', now() + interval '10 minutes'), true,
  'retryable refund failure schedules bounded backoff');
select is(public.fail_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000002',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000002'),
  'provider_unavailable', now() + interval '10 minutes'), true,
  'failure response-loss replay is idempotent');
select is(public.fail_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000002',
  gen_random_uuid(), 'provider_unavailable', now() + interval '10 minutes'), false,
  'a stale owner cannot change scheduled failure');
select throws_ok($q$select public.fail_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000003',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000003'),
  'raw provider detail!', now() + interval '10 minutes')$q$,
  'P0001', 'invalid Square payment remediation failure',
  'failure boundary rejects raw provider detail');

update app_private.square_payment_remediation_outbox set
  available_at = now() - interval '1 second'
where order_id in ('f7770000-0000-4000-8000-000000000001',
  'f7770000-0000-4000-8000-000000000003');
create temporary table second_claims as
select * from public.claim_due_square_payment_remediations(now(), 50);
select is((select count(*) from second_claims), 2::bigint,
  'pending refund and expired lease are reclaimed');
select isnt((select claim_generation from second_claims where order_id =
  'f7770000-0000-4000-8000-000000000001'),
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'),
  'reclamation rotates the ownership generation');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'), 'refund-one', 'COMPLETED'), false,
  'stale finalizer cannot complete a reclaimed refund');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from second_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'), 'refund-one', 'COMPLETED'), true,
  'current owner records completed refund');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from second_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'), 'refund-one', 'COMPLETED'), true,
  'completed finalizer response-loss replay is idempotent');
select is((select status from app_private.square_payment_remediation_outbox
  where order_id = 'f7770000-0000-4000-8000-000000000001'), 'completed',
  'completed remediation is terminal');
select results_eq($q$select order_id, type::text, refund_cents from public.order_events
  where square_refund_id = 'refund-one'$q$,
  $$values ('f7770000-0000-4000-8000-000000000001'::uuid,
    'cancelled'::text, 1000::bigint)$$, 'completed refund has a typed accounting event');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000001',
  (select claim_generation from second_claims where order_id =
    'f7770000-0000-4000-8000-000000000001'), 'refund-other', 'COMPLETED'), false,
  'completed remediation fingerprint rejects a different refund');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000003',
  (select claim_generation from second_claims where order_id =
    'f7770000-0000-4000-8000-000000000003'), 'refund-three', 'COMPLETED'), true,
  'expired processing lease completes under its current owner');

update app_private.square_payment_remediation_outbox set
  available_at = now() - interval '1 second'
where order_id = 'f7770000-0000-4000-8000-000000000002';
create temporary table third_claims as
select * from public.claim_due_square_payment_remediations(now(), 50);
select is((select count(*) from third_claims), 1::bigint,
  'failed remediation becomes due at its exact retry time');
select is(public.fail_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000002',
  (select claim_generation from first_claims where order_id =
    'f7770000-0000-4000-8000-000000000002'),
  'provider_unavailable', now() + interval '12 minutes'), false,
  'prior failure owner stays stale after retry claim');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000002',
  (select claim_generation from third_claims), 'refund-one', 'COMPLETED'), false,
  'provider refund identity cannot cross-bind between orders');
select is(pg_temp.test_finalize_square_payment_remediation(
  'f7770000-0000-4000-8000-000000000002',
  (select claim_generation from third_claims), 'refund-two', 'COMPLETED'), true,
  'retried remediation completes with its own refund');
select is((select count(*) from app_private.square_payment_remediation_outbox
  where status = 'completed'), 3::bigint, 'all completed remediations remain durable');
select is((select count(*) from public.order_events
  where square_refund_id in ('refund-one', 'refund-two', 'refund-three')),
  3::bigint, 'each provider refund is accounted exactly once');
select is((select count(*) from public.platform_fees where brand_id =
  'f7777777-7777-4777-8777-777777777777'), 3::bigint,
  'refund completion never erases collected-fee evidence');

select * from finish();
rollback;
