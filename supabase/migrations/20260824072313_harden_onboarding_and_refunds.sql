-- Production hardening found by exercising the complete local Supabase stack.
-- This migration is additive so deployed projects and fresh resets converge.

-- New hosted projects include this event-trigger function, but its default
-- EXECUTE grant exposes a SECURITY DEFINER RPC to both client roles. The event
-- trigger keeps working without client execution rights. Local images that do
-- not ship the helper simply skip this block.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Onboarding upserts categories by this natural key. Without the constraint,
-- PostgREST rejects ON CONFLICT before the first tenant can be seeded.
create unique index menu_categories_menu_title_idx
  on public.menu_categories (menu_id, title);
create unique index locations_brand_name_idx
  on public.locations (brand_id, name);

-- Square can send the same refund under more than one delivery event id. Keep
-- both identifiers: event id deduplicates deliveries; refund id deduplicates
-- the underlying money movement.
alter table public.order_events add column square_refund_id text;
create unique index order_events_square_refund_idx
  on public.order_events (square_refund_id)
  where square_refund_id is not null;

-- Every FK used by joins, RLS, or cascading deletes needs a covering index.
create index campaigns_drop_idx on public.campaigns (drop_id) where drop_id is not null;
create index crew_completions_brand_idx on public.crew_task_completions (brand_id);
create index crew_completions_user_idx on public.crew_task_completions (completed_by);
create index crew_tasks_location_idx on public.crew_tasks (location_id);
create index drops_item_idx on public.drops (item_id);
create index locations_square_connection_idx on public.locations (square_connection_id)
  where square_connection_id is not null;
create index loyalty_events_brand_idx on public.loyalty_events (brand_id);
create index menu_categories_brand_idx on public.menu_categories (brand_id);
create index menu_items_single_item_idx on public.menu_items (single_item_id)
  where single_item_id is not null;
create index order_events_brand_idx on public.order_events (brand_id);
create index platform_fees_brand_idx on public.platform_fees (brand_id);
create index prep_batches_assignee_idx on public.prep_batches (assigned_to)
  where assigned_to is not null;
create index prep_batches_recipe_idx on public.prep_batches (recipe_id);
create index push_tokens_brand_idx on public.push_tokens (brand_id);
create index referrals_referred_customer_idx on public.referrals (referred_customer_id)
  where referred_customer_id is not null;
create index shifts_brand_user_idx on public.shifts (brand_user_id);
create index square_connections_brand_idx on public.square_connections (brand_id);
create index stored_value_brand_idx on public.stored_value_ledger (brand_id);
create index stored_value_order_idx on public.stored_value_ledger (order_id)
  where order_id is not null;

-- These tables are server-only. Explicit service policies document that fact
-- and keep advisors from mistaking intentional deny-by-default RLS for an
-- unfinished table. Client privileges are revoked as the coarse first gate.
revoke all on public.square_connections, public.webhook_events, public.push_tokens
  from anon, authenticated;
create policy square_connections_service on public.square_connections
  for all to service_role using (true) with check (true);
create policy webhook_events_service on public.webhook_events
  for all to service_role using (true) with check (true);
create policy push_tokens_service on public.push_tokens
  for all to service_role using (true) with check (true);

-- A service-role request has no app role claim. The previous DISTINCT FROM
-- check therefore blocked the very bootstrap path its comment promised to
-- allow. A signed client still needs an existing platform_admin claim.
create or replace function app.protect_platform_admin_grant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'platform_admin'
     and app.jwt_role() is not null
     and app.jwt_role() is distinct from 'platform_admin' then
    raise exception 'only the platform operator may grant platform_admin';
  end if;
  return new;
end $$;

-- Pin every helper's lookup path. This covers invoker helpers too and removes
-- a class of future privilege-escalation bugs if any helper later becomes a
-- definer function.
do $$
declare
  function_name text;
begin
  for function_name in
    select format('%I.%I(%s)', namespace.nspname, procedure.proname,
                  pg_get_function_identity_arguments(procedure.oid))
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app'
  loop
    execute format('alter function %s set search_path = %L', function_name, '');
  end loop;
end $$;

-- Cache auth.uid() once per statement instead of once per candidate row.
alter policy brand_users_select on public.brand_users using (
  app.is_brand_owner(brand_id) or user_id = (select auth.uid())
);
alter policy customers_insert on public.customers with check (
  user_id = (select auth.uid()) and brand_id = app.jwt_brand_id()
);
alter policy customers_select on public.customers using (
  user_id = (select auth.uid())
  or (app.is_brand_staff(brand_id)
      and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
  or (app.is_brand_staff(brand_id)
      and app.customer_ordered_at(id, app.jwt_location_ids()))
);
alter policy customers_update on public.customers
  using (
    user_id = (select auth.uid())
    or (app.is_brand_staff(brand_id)
        and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id)
        and app.customer_ordered_at(id, app.jwt_location_ids()))
  )
  with check (app.is_brand_staff(brand_id) or user_id = (select auth.uid()));
alter policy orders_select on public.orders using (
  app.is_brand_owner(brand_id)
  or app.at_location(brand_id, location_id)
  or exists (
    select 1 from public.customers customer
    where customer.id = orders.customer_id
      and customer.user_id = (select auth.uid())
  )
);
alter policy order_events_select on public.order_events using (
  app.is_brand_owner(brand_id)
  or exists (
    select 1 from public.orders target
    where target.id = order_events.order_id
      and (
        app.at_location(target.brand_id, target.location_id)
        or exists (
          select 1 from public.customers customer
          where customer.id = target.customer_id
            and customer.user_id = (select auth.uid())
        )
      )
  )
);
alter policy order_events_insert on public.order_events with check (
  source = 'operator'
  and type in ('paid', 'in_progress', 'ready', 'picked_up', 'cancelled')
  and actor_user_id = (select auth.uid())
  and exists (
    select 1 from public.orders target
    where target.id = order_events.order_id
      and target.brand_id = order_events.brand_id
      and app.at_location(target.brand_id, target.location_id)
  )
);
alter policy crew_completions_insert on public.crew_task_completions with check (
  app.at_location(brand_id, location_id)
  and completed_by = (select auth.uid())
);
alter policy loyalty_accounts_select on public.loyalty_accounts using (
  exists (
    select 1 from public.customers customer
    where customer.id = loyalty_accounts.customer_id
      and customer.user_id = (select auth.uid())
  )
  or (app.is_brand_staff(brand_id)
      and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
  or (app.is_brand_staff(brand_id)
      and app.customer_ordered_at(customer_id, app.jwt_location_ids()))
);
alter policy loyalty_events_select on public.loyalty_events using (
  exists (
    select 1
    from public.loyalty_accounts account
    join public.customers customer on customer.id = account.customer_id
    where account.id = loyalty_events.account_id
      and customer.user_id = (select auth.uid())
  )
  or (app.is_brand_staff(brand_id)
      and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
  or (app.is_brand_staff(brand_id) and exists (
    select 1 from public.loyalty_accounts account
    where account.id = loyalty_events.account_id
      and app.customer_ordered_at(account.customer_id, app.jwt_location_ids())
  ))
);
alter policy stored_value_select on public.stored_value_ledger using (
  exists (
    select 1 from public.customers customer
    where customer.id = stored_value_ledger.customer_id
      and customer.user_id = (select auth.uid())
  )
  or (app.is_brand_staff(brand_id)
      and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
  or (app.is_brand_staff(brand_id)
      and app.customer_ordered_at(customer_id, app.jwt_location_ids()))
);
alter policy referrals_select on public.referrals using (
  exists (
    select 1 from public.customers customer
    where customer.id = referrals.referrer_customer_id
      and customer.user_id = (select auth.uid())
  )
  or (app.is_brand_staff(brand_id)
      and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
  or (app.is_brand_staff(brand_id)
      and app.customer_ordered_at(referrer_customer_id, app.jwt_location_ids()))
);

-- Ledger row + projection move are one transaction. The old two-request
-- sequence could permanently record an earn/reversal without moving balance
-- when the second request failed, and retries then stopped at the unique row.
create or replace function public.loyalty_record_earn(
  target_brand uuid,
  target_customer uuid,
  target_order uuid,
  earned_points bigint
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  inserted_count integer;
begin
  if earned_points <= 0 then return 0; end if;

  perform 1 from public.orders target
  where target.id = target_order
    and target.brand_id = target_brand
    and target.customer_id = target_customer
  for update;
  if not found then raise exception 'loyalty earn target does not match order'; end if;

  insert into public.loyalty_accounts (brand_id, customer_id)
  values (target_brand, target_customer)
  on conflict (customer_id) do update set customer_id = excluded.customer_id
  returning id into account_id;

  insert into public.loyalty_events
    (brand_id, account_id, order_id, type, points)
  values (target_brand, account_id, target_order, 'earn', earned_points)
  on conflict (order_id) where type = 'earn' do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return 0; end if;

  update public.loyalty_accounts
  set points_balance = points_balance + earned_points,
      lifetime_points = lifetime_points + earned_points,
      updated_at = now()
  where id = account_id;
  return earned_points;
end $$;

create or replace function public.loyalty_reverse_earn(
  target_brand uuid,
  target_customer uuid,
  target_order uuid,
  order_total_cents bigint,
  refunded_cents bigint,
  cause_key text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  earned_points bigint;
  account_id uuid;
  already_reversed bigint;
  proportional_points bigint;
  reversal_points bigint;
begin
  if target_customer is null or order_total_cents <= 0 or refunded_cents <= 0 then return 0; end if;
  if cause_key is null or cause_key = '' or length(cause_key) > 200 then
    raise exception 'loyalty reversal needs a bounded cause key';
  end if;

  perform 1 from public.orders target
  where target.id = target_order
    and target.brand_id = target_brand
    and target.customer_id = target_customer
  for update;
  if not found then raise exception 'loyalty reversal target does not match order'; end if;

  select event.points, event.account_id
  into earned_points, account_id
  from public.loyalty_events event
  where event.order_id = target_order and event.type = 'earn'
  for update;
  if not found then return 0; end if;

  perform 1 from public.loyalty_accounts account where account.id = account_id for update;
  if exists (
    select 1 from public.loyalty_events event
    where event.order_id = target_order and event.type = 'reverse' and event.note = cause_key
  ) then return 0; end if;

  select coalesce(sum(abs(event.points)), 0)
  into already_reversed
  from public.loyalty_events event
  where event.order_id = target_order and event.type = 'reverse';

  proportional_points := round(
    earned_points * least(1::numeric, refunded_cents::numeric / order_total_cents)
  )::bigint;
  reversal_points := least(proportional_points, greatest(0, earned_points - already_reversed));
  if reversal_points <= 0 then return 0; end if;

  insert into public.loyalty_events
    (brand_id, account_id, order_id, type, points, note)
  values (target_brand, account_id, target_order, 'reverse', -reversal_points, cause_key);
  update public.loyalty_accounts
  set points_balance = greatest(0, points_balance - reversal_points),
      updated_at = now()
  where id = account_id;
  return reversal_points;
exception when unique_violation then
  return 0;
end $$;

create or replace function public.process_square_refund(
  target_order uuid,
  square_event text,
  square_refund text,
  refunded_cents bigint,
  square_event_type text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  charged_cents bigint;
  refunded_before bigint;
  event_type app.order_status;
begin
  if square_event is null or square_event = '' or square_refund is null or square_refund = '' then
    raise exception 'Square event and refund identifiers are required';
  end if;
  if refunded_cents <= 0 then raise exception 'refund amount must be positive'; end if;

  select * into target from public.orders where id = target_order for update;
  if not found then raise exception 'order does not exist'; end if;
  if exists (
    select 1 from public.order_events event
    where event.square_event_id = square_event or event.square_refund_id = square_refund
  ) then return false; end if;

  charged_cents := greatest(0, target.total_cents - target.stored_value_applied_cents);
  if charged_cents = 0 then raise exception 'order has no Square-funded amount'; end if;
  select coalesce(sum((event.snapshot ->> 'refunded_cents')::bigint), 0)
  into refunded_before
  from public.order_events event
  where event.order_id = target_order
    and event.square_refund_id is not null
    and event.snapshot ->> 'refunded_cents' ~ '^[0-9]+$';

  event_type := case
    when refunded_before + refunded_cents >= charged_cents then 'refunded'::app.order_status
    else target.status
  end;
  insert into public.order_events
    (brand_id, order_id, type, snapshot, square_event_id, square_refund_id, source)
  values (
    target.brand_id,
    target.id,
    event_type,
    jsonb_build_object(
      'square_event', square_event_type,
      'square_event_id', square_event,
      'square_refund_id', square_refund,
      'refunded_cents', refunded_cents
    ),
    square_event,
    square_refund,
    'webhook'
  );

  perform public.loyalty_reverse_earn(
    target.brand_id,
    target.customer_id,
    target.id,
    target.total_cents,
    refunded_cents,
    'square_refund:' || square_refund
  );
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.loyalty_record_earn(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.loyalty_reverse_earn(uuid, uuid, uuid, bigint, bigint, text)
  from public, anon, authenticated;
revoke all on function public.process_square_refund(uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.loyalty_record_earn(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.loyalty_reverse_earn(uuid, uuid, uuid, bigint, bigint, text) to service_role;
grant execute on function public.process_square_refund(uuid, text, text, bigint, text) to service_role;
