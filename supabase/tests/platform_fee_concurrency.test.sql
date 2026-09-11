begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(21);

select dblink_connect('fee_worker_a', format(
  'host=127.0.0.1 port=%s dbname=%s user=%s password=postgres',
  current_setting('port'), current_database(), current_user));
select dblink_connect('fee_worker_b', format(
  'host=127.0.0.1 port=%s dbname=%s user=%s password=postgres',
  current_setting('port'), current_database(), current_user));
select dblink_exec('fee_worker_a', 'set time zone ''UTC''');
select dblink_exec('fee_worker_b', 'set time zone ''UTC''');
select dblink_exec('fee_worker_b', $setup$
  delete from public.platform_fee_quotes where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.platform_fees where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.order_events where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.orders where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.square_connections where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.locations where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.brands where id = 'f8888888-8888-4888-8888-888888888888';
  insert into public.brands (
    id, slug, name, fee_bps, fee_bps_tier2, tier_threshold_cents
  ) values ('f8888888-8888-4888-8888-888888888888',
    'fee-concurrency', 'Fee Concurrency', 300, 150, 100000);
  insert into public.locations (id, brand_id, name, timezone) values
    ('f8880000-0000-4000-8000-000000000001',
     'f8888888-8888-4888-8888-888888888888', 'Concurrency Location', 'UTC');
  insert into public.square_connections (
    id, brand_id, location_id, merchant_id, square_location_id,
    access_token_encrypted, refresh_token_encrypted, expires_at,
    connection_generation
  ) values (
    'f8880000-0000-4000-8000-000000000099',
    'f8888888-8888-4888-8888-888888888888',
    'f8880000-0000-4000-8000-000000000001', 'merchant-concurrent',
    'location-concurrent', 'ciphertext-access', 'ciphertext-refresh',
    now() + interval '1 hour', 'f8880000-0000-4000-8000-000000000098');
  insert into public.orders (
    id, brand_id, location_id, status, tender_type, subtotal_cents,
    total_cents, square_order_id, square_payment_id
  ) values
    ('f8880000-0000-4000-8000-000000000001',
     'f8888888-8888-4888-8888-888888888888',
     'f8880000-0000-4000-8000-000000000001', 'created', 'square_card',
     1000, 1000, null, null),
    ('f8880000-0000-4000-8000-000000000002',
     'f8888888-8888-4888-8888-888888888888',
     'f8880000-0000-4000-8000-000000000001', 'created', 'square_card',
     1000, 1000, 'concurrent-order-2', 'concurrent-payment-2');
  insert into public.platform_fee_quotes (
    order_id, brand_id, location_id, month_start, month_end, gross_cents,
    fee_cents, fee_bps_applied, expires_at, claim_generation
  ) values ('f8880000-0000-4000-8000-000000000002',
    'f8888888-8888-4888-8888-888888888888',
    'f8880000-0000-4000-8000-000000000001', date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
    now() - interval '1 second', 'f8880000-0000-4000-8000-000000000002');
$setup$);

select is(dblink_send_query('fee_worker_a', $worker_a$
  with claimed as materialized (
    select quote_claim_generation generation, quote_claim_created created
    from public.claim_platform_fee_quote(
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
      date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098')
  ), paused as materialized (select pg_sleep(2) from claimed)
  select generation::text, created from claimed cross join paused
$worker_a$), 1, 'the first quote claimant starts asynchronously');
select pg_sleep(0.3);
select is(dblink_is_busy('fee_worker_a'), 1,
  'the first claimant holds the location-month serialization lock');
select results_eq($test$
  select created, generation is null from dblink('fee_worker_b', $worker_b$
    select quote_claim_created, quote_claim_generation::text
    from public.claim_platform_fee_quote(
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
      date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098')
  $worker_b$) as result(created boolean, generation text)
$test$, $$values (false, true)$$,
  'a waiting replay cannot rotate or receive the live owner token');
create temporary table first_owner as
select * from dblink_get_result('fee_worker_a') as result(generation uuid, created boolean);
select * from dblink_get_result('fee_worker_a') as result(generation uuid, created boolean);
select is((select created from first_owner), true, 'the first claimant owns the quote');
select is((select claim_generation from public.platform_fee_quotes where order_id =
  'f8880000-0000-4000-8000-000000000001'),
  (select generation from first_owner), 'the stored generation remains the first owner token');
select results_eq($test$
  select released from dblink('fee_worker_b', $worker_b$
    select public.release_platform_fee_quote(
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-999999999999')
  $worker_b$) as result(released boolean)
$test$, $$values (false)$$, 'a non-owner release cannot delete the live reservation');
select is((select count(*) from public.platform_fee_quotes where order_id =
  'f8880000-0000-4000-8000-000000000001'), 1::bigint,
  'the owner reservation survives the contending release');
select throws_ok($test$
  select * from dblink('fee_worker_b', $worker_b$
    select * from public.claim_square_connection_mutation(
      'f8888888-8888-4888-8888-888888888888',
      'f8880000-0000-4000-8000-000000000001', gen_random_uuid(), 'disconnect',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098',
      'ciphertext-access', 'ciphertext-refresh')
  $worker_b$) as result(generation uuid, state text, created boolean,
    connection_id uuid, connection_generation uuid, access_cipher text,
    refresh_cipher text)
$test$, '55000', 'square_connection_has_active_payment_state',
  'a committed fee reservation blocks connection mutation');
select dblink_exec('fee_worker_b', $cleanup_quote$
  delete from public.platform_fee_quotes where brand_id =
    'f8888888-8888-4888-8888-888888888888'
$cleanup_quote$);
select is(dblink_send_query('fee_worker_a', $worker_a$
  with claimed as materialized (
    select * from public.claim_square_connection_mutation(
      'f8888888-8888-4888-8888-888888888888',
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-000000000090', 'disconnect',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098',
      'ciphertext-access', 'ciphertext-refresh')
  ), paused as materialized (select pg_sleep(2) from claimed)
  select mutation_generation::text, mutation_state from claimed cross join paused
$worker_a$), 1, 'connection mutation starts asynchronously');
select pg_sleep(0.3);
select is(dblink_is_busy('fee_worker_a'), 1,
  'connection mutation holds its transition fence');
select throws_ok($test$
  select * from dblink('fee_worker_b', $worker_b$
    select * from public.claim_platform_fee_quote(
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
      date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098')
  $worker_b$) as result(fee bigint, bps integer, generation uuid, created boolean)
$test$, '55000', 'square_connection_transition_in_progress',
  'a quote cannot enter after a mutation owns the fence');
create temporary table mutation_owner as
select * from dblink_get_result('fee_worker_a') as result(generation uuid, state text);
select * from dblink_get_result('fee_worker_a') as result(generation uuid, state text);
select is((select state from mutation_owner), 'claimed',
  'the exact connection mutation remains claimed');
select results_eq($test$select failed from dblink('fee_worker_b', $worker_b$
  select public.fail_square_connection_mutation(
    'f8888888-8888-4888-8888-888888888888',
    'f8880000-0000-4000-8000-000000000001',
    'f8880000-0000-4000-8000-000000000090', 'pre_provider_test')
$worker_b$) as result(failed boolean)$test$, $$values (true)$$,
  'a definitive pre-provider failure releases the transition fence');
select is(dblink_send_query('fee_worker_a', $worker_a$
  with claimed as materialized (
    select * from public.claim_square_connection_mutation(
      'f8888888-8888-4888-8888-888888888888',
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-000000000091', 'disconnect',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098',
      'ciphertext-access', 'ciphertext-refresh')
  ), paused as materialized (select pg_sleep(2) from claimed)
  select mutation_generation::text, mutation_state from claimed cross join paused
$worker_a$), 1, 'second mutation starts for renewal contention');
select pg_sleep(0.3);
select throws_ok($test$
  select * from dblink('fee_worker_b', $worker_b$
    select * from public.claim_square_connection_mutation(
      'f8888888-8888-4888-8888-888888888888',
      'f8880000-0000-4000-8000-000000000001',
      'f8880000-0000-4000-8000-000000000092', 'renew',
      'f8880000-0000-4000-8000-000000000099',
      'f8880000-0000-4000-8000-000000000098',
      'ciphertext-access', 'ciphertext-refresh')
  $worker_b$) as result(generation uuid, state text, created boolean,
    connection_id uuid, connection_generation uuid, access_cipher text,
    refresh_cipher text)
$test$, '55000', 'square_connection_transition_in_progress',
  'credential renewal claim cannot cross a committed mutation claim');
create temporary table renewal_fence as
select * from dblink_get_result('fee_worker_a') as result(generation uuid, state text);
select * from dblink_get_result('fee_worker_a') as result(generation uuid, state text);
select results_eq($test$select failed from dblink('fee_worker_b', $worker_b$
  select public.fail_square_connection_mutation(
    'f8888888-8888-4888-8888-888888888888',
    'f8880000-0000-4000-8000-000000000001',
    'f8880000-0000-4000-8000-000000000091', 'pre_provider_test')
$worker_b$) as result(failed boolean)$test$, $$values (true)$$,
  'renewal contention leaves the exact owner able to release');
select dblink_exec('fee_worker_b', $seed_cleanup$
  insert into public.platform_fee_quotes (
    order_id, brand_id, location_id, month_start, month_end, gross_cents,
    fee_cents, fee_bps_applied, expires_at, claim_generation
  ) values ('f8880000-0000-4000-8000-000000000002',
    'f8888888-8888-4888-8888-888888888888',
    'f8880000-0000-4000-8000-000000000001', date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
    now() - interval '1 second', 'f8880000-0000-4000-8000-000000000002')
$seed_cleanup$);

select is(dblink_send_query('fee_worker_a', $worker_a$
  with claimed as materialized (
    select order_id, claim_generation from public.claim_due_square_card_quotes(now(), 50)
    where order_id = 'f8880000-0000-4000-8000-000000000002'
  ), paused as materialized (select pg_sleep(2) from claimed)
  select order_id::text, claim_generation::text from claimed cross join paused
$worker_a$), 1, 'the card cleanup worker starts asynchronously');
select pg_sleep(0.3);
select is(dblink_is_busy('fee_worker_a'), 1,
  'cleanup holds the expired quote row while inspecting Square');
select results_eq($test$
  select settled from dblink('fee_worker_b', $worker_b$
    select public.record_square_payment_settlement(
      'f8880000-0000-4000-8000-000000000002', 'concurrent-event-2',
      'concurrent-order-2', 'concurrent-payment-2', 30, 'payment.updated')
  $worker_b$) as result(settled boolean)
$test$, $$values (true)$$,
  'exact settlement waits for cleanup and then wins atomically');
create temporary table cleanup_owner as
select * from dblink_get_result('fee_worker_a') as result(order_id uuid, generation uuid);
select * from dblink_get_result('fee_worker_a') as result(order_id uuid, generation uuid);
select ok((select generation is not null from cleanup_owner),
  'the cleanup worker returns its exact rotated generation');
select results_eq($test$
  select status::text,
    (select count(*) from public.platform_fee_quotes where order_id = target.id)::bigint,
    (select count(*) from public.platform_fees where order_id = target.id)::bigint
  from public.orders target where target.id = 'f8880000-0000-4000-8000-000000000002'
$test$, $$values ('paid'::text, 0::bigint, 1::bigint)$$,
  'the cleanup/settlement race leaves one receipt and no reservation');

select dblink_exec('fee_worker_b', $cleanup$
  delete from public.platform_fee_quotes where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.platform_fees where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.order_events where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.orders where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.square_connections where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.locations where brand_id =
    'f8888888-8888-4888-8888-888888888888';
  delete from public.brands where id = 'f8888888-8888-4888-8888-888888888888';
$cleanup$);
select dblink_disconnect('fee_worker_a');
select dblink_disconnect('fee_worker_b');
select * from finish();
rollback;
