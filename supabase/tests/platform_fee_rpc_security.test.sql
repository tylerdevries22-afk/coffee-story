begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(200);

create temporary table fee_rpc_contracts (signature text primary key);
insert into fee_rpc_contracts values
  ('public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,uuid,uuid,boolean)'),
  ('public.release_platform_fee_quote(uuid,uuid)'),
  ('public.bind_square_checkout_link(uuid,uuid,text,text,text)'),
  ('public.bind_square_checkout_link_replay(uuid,text,text,text)'),
  ('public.bind_square_payment_attempt(uuid,uuid,text)'),
  ('public.bind_square_payment(uuid,uuid,text,text)'),
  ('public.finalize_square_card_payment(uuid,uuid,text,text,bigint)'),
  ('public.get_square_payment_quote(uuid,text)'),
  ('public.record_square_payment_settlement(uuid,text,text,text,bigint,text)'),
  ('public.claim_due_square_checkout_quotes(timestamptz,integer)'),
  ('public.expire_square_checkout_quote(uuid,uuid,text,text,bigint,text)'),
  ('public.claim_due_square_card_quotes(timestamptz,integer)'),
  ('public.expire_square_card_quote(uuid,uuid,text,bigint,text,text,text)'),
  ('public.claim_due_square_payment_remediations(timestamptz,integer)'),
  ('public.finalize_square_payment_remediation(uuid,uuid,text,text,text,bigint,text)'),
  ('public.fail_square_payment_remediation(uuid,uuid,text,timestamptz)'),
  ('public.count_square_payment_remediation_alerts()'),
  ('public.process_square_refund(uuid,text,text,bigint,text)'),
  ('public.claim_square_connection_mutation(uuid,uuid,uuid,text,uuid,uuid,text,text)'),
  ('public.finalize_square_connection_replacement(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,integer)'),
  ('public.finalize_square_connection_renewal(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz)'),
  ('public.finalize_square_connection_disconnect(uuid,uuid,uuid,uuid,uuid)'),
  ('public.fail_square_connection_mutation(uuid,uuid,uuid,text)'),
  ('public.count_square_connection_mutation_alerts()'),
  ('public.claim_operation_notification_batch(integer)');

select ok(to_regprocedure(signature) is not null,
  signature || ' exists') from fee_rpc_contracts;
select ok(not exists (
    select 1 from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ), 'PUBLIC cannot execute ' || contract.signature)
from fee_rpc_contracts contract
left join pg_proc proc on proc.oid = to_regprocedure(contract.signature);
select ok(not has_function_privilege('anon', signature, 'EXECUTE'),
  'anon cannot execute ' || signature) from fee_rpc_contracts;
select ok(not has_function_privilege('authenticated', signature, 'EXECUTE'),
  'authenticated cannot execute ' || signature) from fee_rpc_contracts;
select ok(has_function_privilege('service_role', signature, 'EXECUTE'),
  'service role can execute ' || signature) from fee_rpc_contracts;
select ok(proc.prosecdef and 'search_path=""' = any(coalesce(proc.proconfig, '{}'::text[])),
  contract.signature || ' is definer-secured with an empty search path')
from fee_rpc_contracts contract
left join pg_proc proc on proc.oid = to_regprocedure(contract.signature);

select is(pg_get_function_result(to_regprocedure(
  'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,uuid,uuid,boolean)')),
  'TABLE(quoted_fee_cents bigint, quoted_fee_bps_applied integer, quote_claim_generation uuid, quote_claim_created boolean)',
  'claim result exposes ownership explicitly');
select is((select pronargdefaults from pg_proc where oid = to_regprocedure(
  'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,uuid,uuid,boolean)')),
  1::smallint, 'claim keeps one trailing default');
select is(to_regprocedure(
  'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,boolean)'),
  null, 'unfenced nine-argument claim overload is gone');
select is(to_regprocedure('public.release_platform_fee_quote(uuid)'), null,
  'unfenced release overload is gone');
select is(to_regprocedure(
  'public.record_square_payment_settlement(uuid,text,text,bigint,text)'), null,
  'settlement overload without Square order proof is gone');
select is(to_regprocedure('public.expire_square_checkout_quote(uuid,text)'), null,
  'unfenced checkout expiry overload is gone');
select is(to_regprocedure(
  'public.expire_square_checkout_quote(uuid,uuid,text,text)'), null,
  'checkout expiry overload without terminal proof is gone');
select is(to_regprocedure('public.expire_square_card_quote(uuid,uuid,text)'), null,
  'card expiry overload without terminal proof is gone');
select is(to_regprocedure(
  'public.finalize_square_payment_remediation(uuid,uuid,text,text)'), null,
  'remediation finalizer without provider proof is gone');

select has_index('public', 'platform_fee_quotes',
  'platform_fee_quotes_cleanup_queue_idx', 'quote cleanup queue is indexed');
select has_index('public', 'platform_fees',
  'platform_fees_order_unique_idx', 'each order has at most one fee receipt');
select has_index('public', 'platform_fees',
  'platform_fees_location_month_idx', 'reserved pricing month is indexed');
select has_index('app_private', 'square_attempt_terminal_evidence',
  'square_attempt_terminal_payment_idx', 'terminal payment identity is unique');
select has_index('app_private', 'square_attempt_terminal_evidence',
  'square_attempt_terminal_link_idx', 'terminal hosted-link identity is unique');
select has_index('app_private', 'square_payment_remediation_outbox',
  'square_payment_remediation_due_idx', 'late-settlement remediation queue is indexed');
select has_index('app_private', 'square_connection_mutation_fences',
  'square_connection_mutation_alert_idx', 'connection mutation alerts are indexed');
select has_index('public', 'square_connections',
  'square_connections_generation_idx', 'connection generations are unique');
select has_index('public', 'operation_notification_outbox',
  'operation_outbox_sending_due_idx', 'uncertain notification delivery is indexed');
select has_index('public', 'operation_notification_outbox',
  'operation_outbox_claim_due_idx', 'notification claim queue is indexed');

select ok(exists (select 1 from pg_trigger where
    tgrelid = 'public.platform_fees'::regclass
    and tgname = 'remove_finalized_platform_fee_quote'
    and not tgisinternal and tgenabled <> 'D'
    and tgfoid = 'app.remove_finalized_platform_fee_quote()'::regprocedure),
  'fee settlement removes its finalized quote');
select ok(exists (select 1 from pg_trigger where
    tgrelid = 'public.platform_fees'::regclass
    and tgname = 'assign_platform_fee_pricing_month'
    and not tgisinternal and tgenabled <> 'D'
    and tgfoid = 'app.assign_platform_fee_pricing_month()'::regprocedure),
  'fee receipts receive a stable pricing month');
select ok(exists (select 1 from pg_trigger where
    tgrelid = 'public.square_connections'::regclass
    and tgname = 'guard_square_connection_mutation'
    and not tgisinternal and tgenabled <> 'D'
    and tgfoid = 'app.guard_square_connection_mutation()'::regprocedure),
  'direct Square connection changes are fenced');

create temporary table private_fee_tables (qualified_name text primary key);
insert into private_fee_tables values
  ('app_private.square_attempt_terminal_evidence'),
  ('app_private.square_payment_remediation_outbox'),
  ('app_private.square_connection_mutation_fences');
select ok((select relrowsecurity from pg_class where oid = qualified_name::regclass),
  qualified_name || ' has RLS enabled') from private_fee_tables;
select ok(not has_table_privilege('service_role', qualified_name, 'SELECT')
    and not has_table_privilege('service_role', qualified_name, 'INSERT')
    and not has_table_privilege('service_role', qualified_name, 'UPDATE')
    and not has_table_privilege('service_role', qualified_name, 'DELETE'),
  'service role has no direct access to ' || qualified_name) from private_fee_tables;
select ok(not has_table_privilege('anon', qualified_name, 'SELECT')
    and not has_table_privilege('authenticated', qualified_name, 'SELECT'),
  'client roles cannot read ' || qualified_name) from private_fee_tables;
select ok(not exists (select 1 from pg_class rel,
    lateral aclexplode(coalesce(rel.relacl, acldefault('r', rel.relowner))) acl
    where rel.oid = qualified_name::regclass and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  'PUBLIC cannot access ' || qualified_name) from private_fee_tables;
select ok((select relrowsecurity from pg_class
    where oid = 'public.square_connections'::regclass),
  'Square connections retain RLS');
select ok(not has_table_privilege('service_role', 'public.square_connections', 'INSERT')
    and not has_table_privilege('service_role', 'public.square_connections', 'UPDATE')
    and not has_table_privilege('service_role', 'public.square_connections', 'DELETE'),
  'service role cannot replace connections outside fenced RPCs');
select ok(not has_table_privilege('service_role', 'public.platform_fees', 'INSERT')
    and not has_table_privilege('service_role', 'public.platform_fees', 'DELETE'),
  'service role cannot mutate fee receipts directly');
select ok(not has_table_privilege('service_role', 'public.platform_fee_quotes', 'INSERT')
    and not has_table_privilege('service_role', 'public.platform_fee_quotes', 'UPDATE')
    and not has_table_privilege('service_role', 'public.platform_fee_quotes', 'DELETE'),
  'service role cannot mutate quotes directly');

select ok(exists (select 1 from pg_constraint where
    conrelid = 'public.platform_fees'::regclass
    and conname = 'platform_fees_square_fee_limit'),
  'fee receipts enforce amount-sensitive Square limit');
select ok(exists (select 1 from pg_constraint where
    conrelid = 'public.platform_fees'::regclass
    and conname = 'platform_fees_pricing_month_valid'),
  'fee receipts enforce a valid pricing month');
select ok(exists (select 1 from pg_constraint where
    conrelid = 'public.platform_fee_quotes'::regclass
    and conname = 'platform_fee_quotes_square_fee_limit'),
  'quotes enforce amount-sensitive Square limit');
select ok((select prosrc ~ 'p_fee_bps not between 0 and 9000'
    and prosrc !~ 'p_fee_bps not between 0 and 10000' from pg_proc where oid =
    'public.set_platform_location_fee_overrides(uuid,uuid,uuid,uuid,integer,integer,bigint)'::regprocedure),
  'location fee writer rejects rates above the provider ceiling');
select ok((select prosrc ~ 'p_fee_bps_tier2 not between 0 and 9000'
    and prosrc !~ 'p_fee_bps_tier2 not between 0 and 10000' from pg_proc where oid =
    'public.provision_platform_organization(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,jsonb,integer,integer,bigint)'::regprocedure),
  'organization writer rejects rates above the provider ceiling');
select ok((select convalidated from pg_constraint where
    conrelid = 'public.brands'::regclass and conname = 'brands_square_fee_rate_limit'),
  'brand rate constraint is validated');
select ok((select convalidated from pg_constraint where
    conrelid = 'public.locations'::regclass and conname = 'locations_square_fee_rate_limit'),
  'location rate constraint is validated');
select ok(not (select convalidated from pg_constraint where
    conrelid = 'public.platform_fees'::regclass
    and conname = 'platform_fees_square_fee_limit'),
  'historical fee receipts remain immutable under a forward-only constraint');
select ok((select convalidated from pg_constraint where
    conrelid = 'public.platform_fee_quotes'::regclass
    and conname = 'platform_fee_quotes_square_fee_limit'),
  'active quote constraint is fully validated');

set local role service_role;
select count(*) from public.get_square_payment_quote(
  'f6660000-0000-4000-8000-000000000001', 'order-missing');
select public.count_square_payment_remediation_alerts();
select public.count_square_connection_mutation_alerts();
reset role;
select pass('service role executes the secured quote lookup');
select pass('service role executes remediation alert count');
select pass('service role executes connection mutation alert count');

select * from finish();
rollback;
