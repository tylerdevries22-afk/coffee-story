begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
set local time zone 'UTC';
\ir helpers/platform_fee_quote.sql
select plan(37);

insert into public.brands (
  id, slug, name, fee_bps, fee_bps_tier2, tier_threshold_cents
) values ('f1111111-1111-4111-8111-111111111111', 'fee-fencing', 'Fee Fencing',
  300, 150, 100000);
insert into public.locations (
  id, brand_id, name, timezone, fee_bps, fee_bps_tier2, tier_threshold_cents
) values
  ('f1110000-0000-4000-8000-000000000001',
   'f1111111-1111-4111-8111-111111111111', 'Fee Location', 'UTC', null, null, null),
  ('f1110000-0000-4000-8000-000000000002',
   'f1111111-1111-4111-8111-111111111111', 'Straddle Location', 'UTC', 9000, 0, 1),
  ('f1110000-0000-4000-8000-000000000003',
   'f1111111-1111-4111-8111-111111111111', 'High Rate Location', 'UTC', 9000, 9000, 100000),
  ('f1110000-0000-4000-8000-000000000004',
   'f1111111-1111-4111-8111-111111111111', 'Safe Rate Location', 'UTC', 6000, 6000, 100000);
insert into public.square_connections (
  id, brand_id, location_id, merchant_id, square_location_id,
  access_token_encrypted, refresh_token_encrypted, expires_at
)
select gen_random_uuid(), brand_id, id, 'merchant-' || right(id::text, 4),
  'square-' || right(id::text, 4), 'ciphertext-access', 'ciphertext-refresh',
  now() + interval '1 hour' from public.locations
where brand_id = 'f1111111-1111-4111-8111-111111111111';
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_payment_id
)
select ('f1110000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f1111111-1111-4111-8111-111111111111',
  case when n = 13 then 'f1110000-0000-4000-8000-000000000002'::uuid
    when n in (12, 14, 15) then 'f1110000-0000-4000-8000-000000000003'::uuid
    when n = 16 then 'f1110000-0000-4000-8000-000000000004'::uuid
    else 'f1110000-0000-4000-8000-000000000001'::uuid end,
  case when n = 10 then 'paid'::app.order_status else 'created'::app.order_status end,
  case when n = 9 then 'external' else 'square_card' end,
  case when n = 12 then 1 when n = 13 then 2
    when n in (14, 16) then 499 when n = 15 then 500 else 1000 end,
  case when n = 12 then 1 when n = 13 then 2
    when n in (14, 16) then 499 when n = 15 then 500 else 1000 end,
  case when n = 7 then 'payment-already-bound' end
from generate_series(1, 16) n;

create temporary table first_claim as select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000001',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
select is((select quote_claim_created from first_claim), true, 'fresh claim reports ownership');
select ok((select quote_claim_generation is not null from first_claim), 'fresh claim has a token');
create temporary table live_claim as select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000001',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
select is((select quote_claim_created from live_claim), false, 'live replay is read-only');
select is((select quote_claim_generation from live_claim), null::uuid,
  'live replay receives no releasable ownership token');
select is((select claim_generation from public.platform_fee_quotes where order_id =
  'f1110000-0000-4000-8000-000000000001'),
  (select quote_claim_generation from first_claim), 'live replay preserves stored owner');
select ok((select expires_at > now() from public.platform_fee_quotes where order_id =
  'f1110000-0000-4000-8000-000000000001'), 'live replay preserves lease');
update public.platform_fee_quotes set expires_at = now() - interval '1 second'
where order_id = 'f1110000-0000-4000-8000-000000000001';
create temporary table reclaimed as select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000001',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
select is((select quote_claim_created from reclaimed), true, 'expired claim is reclaimed');
select isnt((select quote_claim_generation from reclaimed),
  (select quote_claim_generation from first_claim), 'reclaim rotates ownership');
select ok((select expires_at > now() from public.platform_fee_quotes where order_id =
  'f1110000-0000-4000-8000-000000000001'), 'reclaim renews lease');
select is(public.release_platform_fee_quote('f1110000-0000-4000-8000-000000000001',
  (select quote_claim_generation from first_claim)), false, 'stale release is fenced');
select is(public.release_platform_fee_quote('f1110000-0000-4000-8000-000000000001',
  (select quote_claim_generation from reclaimed)), true, 'current owner can release');

create temporary table bound_claim as select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000002',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
select is(public.bind_square_payment_attempt('f1110000-0000-4000-8000-000000000002',
  (select quote_claim_generation from bound_claim), 'square-order-bound'), true,
  'current owner prebinds provider order');
select is(public.release_platform_fee_quote('f1110000-0000-4000-8000-000000000002',
  (select quote_claim_generation from bound_claim)), false, 'provider-bound quote cannot release');

insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, cleanup_claimed_at
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  case when id in ('f1110000-0000-4000-8000-000000000004'::uuid,
    'f1110000-0000-4000-8000-000000000005'::uuid,
    'f1110000-0000-4000-8000-000000000006'::uuid)
    then now() - interval '1 second' else now() + interval '1 hour' end,
  case when id = 'f1110000-0000-4000-8000-000000000006'::uuid then now() end
from public.orders where id between 'f1110000-0000-4000-8000-000000000003'::uuid
  and 'f1110000-0000-4000-8000-000000000006'::uuid;
update public.orders set square_order_id = 'square-order-expired'
where id = 'f1110000-0000-4000-8000-000000000005';
select throws_ok($q$insert into public.order_events (brand_id, order_id, type, source)
 values ('f1111111-1111-4111-8111-111111111111','f1110000-0000-4000-8000-000000000003',
 'cancelled','customer')$q$, 'P0001', 'square_card_payment_in_flight',
 'active quote fences cancellation');
select is((select status::text from public.orders where id =
  'f1110000-0000-4000-8000-000000000003'), 'created', 'failed cancellation is atomic');
select lives_ok($q$insert into public.order_events (brand_id, order_id, type, source)
 values ('f1111111-1111-4111-8111-111111111111','f1110000-0000-4000-8000-000000000004',
 'cancelled','customer')$q$, 'expired unbound quote permits cancellation');
select is((select status::text from public.orders where id =
  'f1110000-0000-4000-8000-000000000004'), 'cancelled', 'unbound order is cancelled');
select lives_ok($q$insert into public.order_events (brand_id, order_id, type, source)
 values ('f1111111-1111-4111-8111-111111111111','f1110000-0000-4000-8000-000000000004',
 'cancelled','customer')$q$, 'customer cancellation replay is idempotent');
select is((select count(*) from public.platform_fee_quotes where order_id =
  'f1110000-0000-4000-8000-000000000004'), 1::bigint, 'quote waits for locked cleanup');
select throws_ok($q$insert into public.order_events (brand_id, order_id, type, source)
 values ('f1111111-1111-4111-8111-111111111111','f1110000-0000-4000-8000-000000000005',
 'cancelled','customer')$q$, 'P0001', 'square_card_payment_in_flight',
 'expired bound attempt stays fenced');
select throws_ok($q$insert into public.order_events (brand_id, order_id, type, source)
 values ('f1111111-1111-4111-8111-111111111111','f1110000-0000-4000-8000-000000000006',
 'cancelled','customer')$q$, 'P0001', 'square_card_payment_in_flight',
 'cleanup ownership stays fenced');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000007','f1110000-0000-4000-8000-000000000001',
 1000,300,150,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
 'P0001', 'order does not match platform fee quote', 'payment-bound order cannot claim');
insert into public.platform_fees (brand_id, location_id, order_id, gross_cents, fee_cents,
 fee_bps_applied, square_payment_id) values ('f1111111-1111-4111-8111-111111111111',
 'f1110000-0000-4000-8000-000000000001','f1110000-0000-4000-8000-000000000008',
 1000,30,300,'fee-settled');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000008','f1110000-0000-4000-8000-000000000001',
 1000,300,150,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
 'P0001', 'order does not match platform fee quote', 'settled order cannot reclaim');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000009','f1110000-0000-4000-8000-000000000001',
 1000,300,150,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
 'P0001', 'order does not match platform fee quote', 'non-Square tender cannot claim');
select throws_ok($q$insert into public.order_events (brand_id, order_id, type, source)
 values ('f1111111-1111-4111-8111-111111111111','f1110000-0000-4000-8000-000000000010',
 'cancelled','customer')$q$, 'P0001', 'customer cancellation is not allowed for this order',
 'paid order cannot be customer-cancelled');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000011','f1110000-0000-4000-8000-000000000001',
 1000,9001,150,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
 'P0001', 'invalid platform fee quote inputs', 'Square rate above 9000 bps is rejected');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000012','f1110000-0000-4000-8000-000000000003',
 1,9000,9000,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
 'P0001', 'Square platform fee exceeds the provider limit', 'one-cent rounding cannot exceed 60%');
create temporary table straddle as select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000013','f1110000-0000-4000-8000-000000000002',
 2,9000,0,1,date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
select is((select quoted_fee_cents from straddle), 1::bigint, 'tier straddle rounds to one cent');
select is((select quoted_fee_bps_applied from straddle), 5000, 'effective rounded bps is deterministic');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000014','f1110000-0000-4000-8000-000000000003',
 499,9000,9000,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
 'P0001', 'Square platform fee exceeds the provider limit',
 'sub-five-dollar USD charge uses the 60 percent cap');
create temporary table small_cap as select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000016','f1110000-0000-4000-8000-000000000004',
 499,6000,6000,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
select is((select quoted_fee_cents from small_cap), 299::bigint,
  'sub-five-dollar cap rounds down to provider-safe money');
select is((select quoted_fee_bps_applied from small_cap), 5992,
  'small-payment effective basis points reflect rounded money');
create temporary table large_cap as select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000015','f1110000-0000-4000-8000-000000000003',
 500,9000,9000,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month');
select is((select quoted_fee_cents from large_cap), 450::bigint,
  'five-dollar USD charge uses the 90 percent cap');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000011','f1110000-0000-4000-8000-000000000001',
  1000,300,150,100000,now()-interval '2 months',now()-interval '1 month')$q$,
  'P0001', 'platform fee quote inputs do not match configured terms',
  'past fee periods are rejected');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000011','f1110000-0000-4000-8000-000000000001',
  1000,300,150,100000,now()+interval '1 month',now()+interval '2 months')$q$,
  'P0001', 'platform fee quote inputs do not match configured terms',
  'future fee periods are rejected');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000011','f1110000-0000-4000-8000-000000000001',
  1000,299,150,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')$q$,
  'P0001', 'platform fee quote inputs do not match configured terms',
  'caller-supplied fee terms must match durable configuration');
select throws_ok($q$select * from pg_temp.test_claim_platform_fee_quote(
 'f1110000-0000-4000-8000-000000000011','f1110000-0000-4000-8000-000000000001',
 1000,300,150,100000,date_trunc('month',now()),date_trunc('month',now())+interval '1 month',true)$q$,
 'P0001', 'existing platform fee quote is required', 'recovery-only claim never creates');

select * from finish();
rollback;
