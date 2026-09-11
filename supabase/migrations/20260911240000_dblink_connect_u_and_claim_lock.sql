create extension if not exists dblink with schema extensions;

-- Non-superuser postgres cannot dblink_connect (even with password=) on
-- current Supabase images; dblink_connect_u is the supported path.
-- Rematching remediation claims must not FOR UPDATE a nullable fence join.

do $grant$
begin
  execute 'grant usage on schema extensions to postgres';
  execute 'grant execute on function extensions.dblink_connect_u(text) to postgres, public';
  execute 'grant execute on function extensions.dblink_connect_u(text, text) to postgres, public';
exception
  when insufficient_privilege then
    raise notice 'dblink_connect_u grant skipped; supabase start applies it as admin';
end
$grant$;

create or replace function public.claim_due_square_payment_remediations(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  order_id uuid,
  brand_id uuid,
  location_id uuid,
  connection_id uuid,
  connection_generation uuid,
  square_order_id text,
  square_payment_id text,
  refund_amount_cents bigint,
  refund_request_key uuid,
  square_refund_id text,
  provider_refund_status text,
  attempt_count integer,
  claim_generation uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 50
    or p_now < pg_catalog.now() - interval '5 minutes'
    or p_now > pg_catalog.now() + interval '5 minutes' then
    raise exception 'invalid Square payment remediation claim inputs';
  end if;
  update app_private.square_payment_remediation_outbox queued set
    status = 'manual_action_required', claimed_at = null,
    manual_action_required_at = coalesce(queued.manual_action_required_at, p_now),
    last_error_code = 'refund_pending_too_long'
  where queued.provider_refund_status = 'PENDING'
    and queued.submitted_at <= p_now - interval '14 days'
    and queued.available_at <= p_now
    and queued.status in ('submitted', 'processing');
  update app_private.square_payment_remediation_outbox queued set
    status = 'manual_action_required', claimed_at = null,
    manual_action_required_at = coalesce(queued.manual_action_required_at, p_now),
    last_error_code = 'refund_connection_unavailable'
  where queued.status <> 'completed'
    and not exists (select 1 from public.square_connections connection
      where connection.id = queued.connection_id
        and connection.connection_generation = queued.connection_generation)
    and not exists (select 1 from app_private.square_connection_mutation_fences fence
      where fence.location_id = queued.location_id
        and fence.mutation_generation is not null);
  return query with due as materialized (
    select queued.order_id
    from app_private.square_payment_remediation_outbox queued
    join public.square_connections connection
      on connection.id = queued.connection_id
      and connection.connection_generation = queued.connection_generation
    where queued.available_at <= p_now
      and not exists (
        select 1 from app_private.square_connection_mutation_fences fence
        where fence.location_id = queued.location_id
          and fence.mutation_generation is not null
      )
      and (
        queued.status = 'submitted'
        or queued.status = 'processing'
        or (queued.status in ('pending', 'failed') and queued.attempt_count < 20)
      )
    order by queued.available_at, queued.order_id
    for update of queued skip locked limit p_limit
  ), claimed as (
    update app_private.square_payment_remediation_outbox queued set
      status = 'processing',
      attempt_count = case
        when queued.square_refund_id is null and queued.attempt_count < 20
          then queued.attempt_count + 1
        else queued.attempt_count
      end,
      poll_attempt_count = queued.poll_attempt_count
        + case when queued.square_refund_id is null then 0 else 1 end,
      claimed_at = p_now,
      claim_generation = gen_random_uuid(),
      available_at = p_now + interval '5 minutes',
      last_error_code = null
    from due where queued.order_id = due.order_id returning queued.*
  )
  select claimed.order_id, claimed.brand_id, claimed.location_id,
    claimed.connection_id, claimed.connection_generation,
    claimed.square_order_id, claimed.square_payment_id,
    claimed.refund_amount_cents, claimed.refund_request_key,
    claimed.square_refund_id, claimed.provider_refund_status,
    claimed.attempt_count, claimed.claim_generation
  from claimed;
end $$;


create or replace function app.assert_dblink_connect_u_and_remediation_claim()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure(
    'public.claim_due_square_payment_remediations(timestamp with time zone, integer)'
  ) is null then
    raise exception 'claim_due_square_payment_remediations is missing';
  end if;
end $$;

revoke all on function app.assert_dblink_connect_u_and_remediation_claim()
  from public, anon, authenticated;
grant execute on function app.assert_dblink_connect_u_and_remediation_claim()
  to service_role;

select app.register_release(
  '20260911240000',
  'dblink_connect_u for tests; remediation claim without nullable FOR UPDATE',
  'app.assert_dblink_connect_u_and_remediation_claim()'::regprocedure
);
