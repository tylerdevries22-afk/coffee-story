-- Catering and delivery are installed capabilities, and until now nothing in
-- the database said so. The fulfillment type arrived in a request body, the HQ
-- route checked it against the four allowed values, commit_order passed it
-- through, and the row landed: any caller holding service_role could book a
-- catering or delivery order against a brand that never installed either, and
-- the shop found out when the ticket printed.
--
-- packages/engine/src/orders/fulfillment-capability.ts now refuses that at the
-- engine layer, and createOrder is the only writer today. This is the same
-- invariant one layer down, in the transaction that writes the row, so it
-- survives a second writer, a direct RPC call, and a future refactor that
-- forgets the guard a process away.
--
-- A trigger rather than a rewrite of commit_order: the rule is about what may
-- be in an orders row, not about one function, so it holds for every writer
-- instead of only the RPC -- and stating it does not require restating a
-- 168-line function to add four lines to it.
--
-- Resolved from module_installations only. brands.catering and brands.delivery
-- are being retired, and a guard that reads a dropped column stops guarding
-- without ever saying so.

create or replace function app.assert_fulfillment_capability()
returns trigger
language plpgsql
-- Definer: the guard must read installations the same way no matter who is
-- inserting. Under invoker rights a caller whose RLS cannot see the
-- installation row would be refused a capability the brand actually holds.
security definer
set search_path = ''
as $$
declare
  v_module text;
begin
  v_module := case new.fulfillment_type
    when 'catering' then 'commerce-catering'
    when 'delivery' then 'commerce-delivery'
    else null
  end;
  -- Pickup and curbside are baseline ordering: nothing to install, so the
  -- common order pays nothing for a gate that cannot apply to it.
  if v_module is null then
    return new;
  end if;

  if not exists (
    select 1 from public.module_installations installation
    where installation.brand_id = new.brand_id
      and installation.module_key = v_module
      and installation.state = 'active'
  ) then
    -- 42501 insufficient_privilege, distinct from the 22023 this function's
    -- callers already use for malformed input: retrying changes nothing,
    -- because the brand does not hold the capability.
    raise exception using
      errcode = '42501',
      message = format('fulfillment capability %s is not installed for this brand', v_module);
  end if;
  return new;
end $$;

revoke all on function app.assert_fulfillment_capability() from public, anon, authenticated;

drop trigger if exists orders_assert_fulfillment_capability on public.orders;
create trigger orders_assert_fulfillment_capability
  before insert on public.orders
  for each row execute function app.assert_fulfillment_capability();

create or replace function app.assert_fulfillment_capability_guard()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.orders'::regclass
      and trigger.tgname = 'orders_assert_fulfillment_capability'
      and not trigger.tgisinternal
  ) then
    raise exception 'fulfillment capability trigger is missing from public.orders';
  end if;
  -- Definer rights are the point: an invoker-rights guard reads installations
  -- through the caller's RLS and can refuse a capability the brand holds.
  if not exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'app'
      and proc.proname = 'assert_fulfillment_capability'
      and proc.prosecdef
  ) then
    raise exception 'fulfillment capability guard is not security definer';
  end if;
end $$;

revoke all on function app.assert_fulfillment_capability_guard() from public, anon, authenticated;
grant execute on function app.assert_fulfillment_capability_guard() to service_role;

select app.register_release(
  '20260912000000',
  'catering and delivery orders require an active module installation',
  'app.assert_fulfillment_capability_guard()'::regprocedure
);
