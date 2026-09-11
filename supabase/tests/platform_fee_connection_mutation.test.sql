begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
set local time zone 'UTC';
select plan(28);

insert into public.brands (
  id, slug, name, fee_bps, fee_bps_tier2, tier_threshold_cents
) values ('f9999999-9999-4999-8999-999999999999',
  'fee-connection', 'Fee Connection', 300, 150, 100000);
insert into public.locations (id, brand_id, name, timezone) values
  ('f9990000-0000-4000-8000-000000000001',
   'f9999999-9999-4999-8999-999999999999', 'Connected', 'UTC'),
  ('f9990000-0000-4000-8000-000000000002',
   'f9999999-9999-4999-8999-999999999999', 'Fresh', 'UTC');
insert into public.square_connections (
  id, brand_id, location_id, merchant_id, square_location_id,
  access_token_encrypted, refresh_token_encrypted, expires_at,
  connection_generation
) values ('f9990000-0000-4000-8000-000000000010',
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001', 'merchant-old', 'square-old',
  'ciphertext-access-old', 'ciphertext-refresh-old', now() + interval '1 hour',
  'f9990000-0000-4000-8000-000000000011');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents
) values ('f9990000-0000-4000-8000-000000000020',
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001', 'created', 'square_card', 1000, 1000);

create temporary table disconnect_claim as select *
from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000030', 'disconnect',
  'f9990000-0000-4000-8000-000000000010',
  'f9990000-0000-4000-8000-000000000011',
  'ciphertext-access-old', 'ciphertext-refresh-old');
select is((select mutation_claim_created from disconnect_claim), true,
  'idle disconnect receives the transition fence');
select is((select access_token_encrypted from disconnect_claim),
  'ciphertext-access-old', 'disconnect receives the exact credential snapshot');
select is((select mutation_claim_created from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000030', 'disconnect',
  'f9990000-0000-4000-8000-000000000010',
  'f9990000-0000-4000-8000-000000000011',
  'ciphertext-access-old', 'ciphertext-refresh-old')), false,
  'exact live mutation replay is read-only');
select throws_ok($q$select * from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000030', 'disconnect',
  'f9990000-0000-4000-8000-000000000010', gen_random_uuid(),
  'ciphertext-access-old', 'ciphertext-refresh-old')$q$,
  '55000', 'square_connection_transition_in_progress',
  'live replay rejects a changed fingerprint');
select is(public.fail_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000030', 'pre_provider_test'), true,
  'definitive pre-provider failure releases the fence');
select is(public.fail_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000030', 'pre_provider_test'), true,
  'failure response-loss replay is exact');
select is(public.fail_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001', gen_random_uuid(),
  'pre_provider_test'), false, 'a stale claimant cannot release the fence');

select is((select mutation_claim_created from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000031', 'replace',
  'f9990000-0000-4000-8000-000000000010',
  'f9990000-0000-4000-8000-000000000011',
  'ciphertext-access-old', 'ciphertext-refresh-old')), true,
  'idle replacement receives the transition fence');
create temporary table replaced as select *
from public.finalize_square_connection_replacement(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000031',
  'f9990000-0000-4000-8000-000000000010',
  'f9990000-0000-4000-8000-000000000011',
  'merchant-new', 'square-new', 'ciphertext-access-new',
  'ciphertext-refresh-new', now() + interval '2 hours', 1);
select is((select connection_id from replaced),
  'f9990000-0000-4000-8000-000000000010'::uuid,
  'replacement preserves the durable connection identity');
select isnt((select connection_generation from replaced),
  'f9990000-0000-4000-8000-000000000011'::uuid,
  'replacement rotates its CAS generation');
select is((select access_token_encrypted from public.square_connections
  where id = 'f9990000-0000-4000-8000-000000000010'),
  'ciphertext-access-new', 'replacement commits the new encrypted grant');
select throws_ok($q$select * from public.finalize_square_connection_replacement(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000031',
  'f9990000-0000-4000-8000-000000000010', gen_random_uuid(),
  'merchant-new', 'square-new', 'ciphertext-access-new',
  'ciphertext-refresh-new', now() + interval '2 hours', 1)$q$,
  '55000', 'square_connection_changed',
  'finished replacement replay checks its original snapshot');
select is((select mutation_state from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000031', 'replace',
  'f9990000-0000-4000-8000-000000000010',
  'f9990000-0000-4000-8000-000000000011',
  'ciphertext-access-old', 'ciphertext-refresh-old')), 'completed',
  'finished claim replay reports its durable outcome');

select is((select mutation_claim_created from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000032', 'renew',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from replaced),
  'ciphertext-access-new', 'ciphertext-refresh-new')), true,
  'renewal claims the same transition fence before provider I/O');
create temporary table renewed as select *
from public.finalize_square_connection_renewal(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000032',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from replaced),
  'ciphertext-access-renewed', 'ciphertext-refresh-new',
  now() + interval '3 hours');
select isnt((select connection_generation from renewed),
  (select connection_generation from replaced),
  'credential renewal rotates the connection generation');
select is((select connection_generation from public.finalize_square_connection_renewal(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000032',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from replaced),
  'ciphertext-access-renewed', 'ciphertext-refresh-new',
  now() + interval '3 hours')),
  (select connection_generation from renewed),
  'renewal finalizer response-loss replay returns the same generation');
select throws_ok($q$update public.square_connections set location_id =
  'f9990000-0000-4000-8000-000000000002' where id =
  'f9990000-0000-4000-8000-000000000010'$q$,
  '22023', 'square_connection_mutation_invalid',
  'direct connection reparenting is rejected');
select throws_ok($q$select * from public.claim_platform_fee_quote(
  'f9990000-0000-4000-8000-000000000020',
  'f9990000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month',now()), date_trunc('month',now()) + interval '1 month',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from replaced))$q$,
  '55000', 'square_connection_changed',
  'a stale runtime cannot claim after credential renewal');
create temporary table quote as select * from public.claim_platform_fee_quote(
  'f9990000-0000-4000-8000-000000000020',
  'f9990000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month',now()), date_trunc('month',now()) + interval '1 month',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from public.square_connections where id =
    'f9990000-0000-4000-8000-000000000010'));
select is((select quote_claim_created from quote), true,
  'the current connection snapshot claims normally');
select throws_ok($q$select * from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001', gen_random_uuid(), 'disconnect',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from public.square_connections where id =
    'f9990000-0000-4000-8000-000000000010'),
  'ciphertext-access-renewed', 'ciphertext-refresh-new')$q$,
  '55000', 'square_connection_has_active_payment_state',
  'an active quote blocks connection mutation');
delete from public.platform_fee_quotes where order_id =
  'f9990000-0000-4000-8000-000000000020';
insert into app_private.square_payment_remediation_outbox (
  order_id, brand_id, location_id, connection_id, connection_generation,
  square_order_id, square_payment_id,
  settlement_event_id, refund_amount_cents, refund_request_key
) values ('f9990000-0000-4000-8000-000000000020',
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001',
  'f9990000-0000-4000-8000-000000000010',
  'f9990000-0000-4000-8000-000000000011',
  'remediation-order',
  'remediation-payment', 'remediation-event', 1000,
  'f9990000-0000-4000-8000-000000000020');
update app_private.square_payment_remediation_outbox set
  status = 'processing', claimed_at = now(), claim_generation = gen_random_uuid(),
  available_at = now() + interval '5 minutes'
where order_id = 'f9990000-0000-4000-8000-000000000020';
select throws_ok($q$select * from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000001', gen_random_uuid(), 'replace',
  'f9990000-0000-4000-8000-000000000010',
  (select connection_generation from public.square_connections where id =
    'f9990000-0000-4000-8000-000000000010'),
  'ciphertext-access-renewed', 'ciphertext-refresh-new')$q$,
  '55000', 'square_connection_provider_operation_in_progress',
  'an outstanding refund remediation blocks replacement');
delete from app_private.square_payment_remediation_outbox where order_id =
  'f9990000-0000-4000-8000-000000000020';

select is((select mutation_claim_created from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000002',
  'f9990000-0000-4000-8000-000000000040', 'replace',
  null, null, null, null)), true, 'an unconnected location can claim replacement');
create temporary table connected as select *
from public.finalize_square_connection_replacement(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000002',
  'f9990000-0000-4000-8000-000000000040', null, null,
  'merchant-fresh', 'square-fresh', 'ciphertext-access-fresh',
  'ciphertext-refresh-fresh', now() + interval '1 hour', 1);
select ok((select connection_id is not null from connected),
  'replacement atomically inserts the first connection');
select is((select mutation_claim_created from public.claim_square_connection_mutation(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000002',
  'f9990000-0000-4000-8000-000000000041', 'disconnect',
  (select connection_id from connected),
  (select connection_generation from connected),
  'ciphertext-access-fresh', 'ciphertext-refresh-fresh')), true,
  'the new connection can claim an exact disconnect');
select is(public.finalize_square_connection_disconnect(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000002',
  'f9990000-0000-4000-8000-000000000041',
  (select connection_id from connected),
  (select connection_generation from connected)), true,
  'disconnect removes only its exact idle connection');
select is(public.finalize_square_connection_disconnect(
  'f9999999-9999-4999-8999-999999999999',
  'f9990000-0000-4000-8000-000000000002',
  'f9990000-0000-4000-8000-000000000041',
  (select connection_id from connected),
  (select connection_generation from connected)), true,
  'disconnect finalizer replay returns its durable result');
select is((select count(*) from public.square_connections where location_id =
  'f9990000-0000-4000-8000-000000000002'), 0::bigint,
  'disconnect leaves no local credential row');
select is(public.count_square_connection_mutation_alerts(), 0::bigint,
  'no completed connection mutation remains alertable');

select * from finish();
rollback;
