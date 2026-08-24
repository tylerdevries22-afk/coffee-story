-- 0031: six tenancy holes an audit executed against a live database, not just
-- read. Every attack below was run and returned the row counts named.

-- ---------------------------------------------------------------------------
-- 1. The definer views were WRITE paths. Worst first.
--
-- `brand_storefront` (0015) and `location_square_status` (0008) are both
-- single-table views of bare column references, which makes them automatically
-- updatable, and neither sets `security_invoker` -- deliberately, because
-- their whole job is to expose a safe subset past a stricter policy. But
-- 0014's `grant all on all tables in schema public to authenticated` reaches
-- views too, so INSERT, UPDATE and DELETE travelled through them as the view
-- owner, outside RLS entirely.
--
-- Executed: `delete from public.brand_storefront where slug = '<victim>'` as a
-- freshly signed-up user holding no brand claim at all returned DELETE 1, and
-- every table cascades from `brands (id) on delete cascade` -- that tenant's
-- locations, encrypted Square tokens, customers, orders and fees went with it.
-- `update public.brand_storefront set name = 'OWNED'` with no WHERE returned
-- UPDATE 2: every tenant on the platform, brand_config and feature flags
-- included. And `delete from public.location_square_status` as a shift lead
-- returned DELETE 1, destroying their brand's Square connection -- the one
-- table with no policies at all, reached through its own status window.
--
-- The read side is what these views are for and it stays. Only the writes go.
revoke insert, update, delete on public.brand_storefront from anon, authenticated;
revoke insert, update, delete on public.location_square_status from anon, authenticated;

-- 0014 set default privileges that grant ALL on future tables, so a later
-- migration adding a view would reopen this. Views created from here on get
-- the same treatment; this line is the reminder, and the two revokes above are
-- the fix for the two that exist.
comment on view public.brand_storefront is
  'Read-only storefront projection. Definer view: never grant write privileges on it.';
comment on view public.location_square_status is
  'Read-only Square status window over square_connections, which has no policies. Definer view: never grant write privileges on it.';

-- ---------------------------------------------------------------------------
-- 2. A brand owner could mint themselves platform_admin.
--
-- `brand_users_update` gates on `app.is_brand_owner(brand_id)` and the row's
-- `role` column is exactly what `app.custom_access_token` (0009) copies into
-- the JWT. Executed: a Brand A owner ran `update public.brand_users set role =
-- 'platform_admin' where user_id = auth.uid()` (UPDATE 1 -- brand_id unchanged,
-- so the with-check passes), refreshed, and the hook minted platform scope.
-- With it: every tenant's fee schedule, the platform's own `platform_fees`
-- revenue, and Brand B's guest PII. `brand_users_write` let them do it for any
-- other user_id too.
--
-- Policies cannot compare OLD and NEW, and this needs to refuse a value rather
-- than a change, so it is a trigger -- the same shape as 0010's identity and
-- menu guards. The service role carries no sub claim and no jwt role, so the
-- engine and the onboarding script stay free to assign it.
create or replace function app.protect_platform_admin_grant() returns trigger
language plpgsql as $$
begin
  if new.role = 'platform_admin' and app.jwt_role() is distinct from 'platform_admin' then
    raise exception 'only the platform operator may grant platform_admin';
  end if;
  return new;
end $$;

drop trigger if exists brand_users_protect_platform_admin on public.brand_users;
create trigger brand_users_protect_platform_admin
  before insert or update on public.brand_users
  for each row execute function app.protect_platform_admin_grant();

-- ---------------------------------------------------------------------------
-- 3. A guest could move their own row into another tenant.
--
-- 0010 froze `customers.user_id` and left `brand_id` free, and the self-service
-- branch of the with-check (`user_id = auth.uid()`) passes whatever brand the
-- new row names. Executed: `update public.customers set brand_id = '<other
-- tenant>' where user_id = auth.uid()` returned UPDATE 1. That guest's name,
-- phone, email and push token then sat inside Brand B, readable by Brand B's
-- owners, while their loyalty, stored value and orders stayed in Brand A --
-- and `unique (brand_id, phone)` let them squat a number so Brand B's real
-- guest could not be created.
create or replace function app.protect_customer_identity() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id and auth.uid() is not null then
    raise exception 'customers.user_id can only be changed by the engine';
  end if;
  -- A customer belongs to the brand it was created in. Moving it strands its
  -- balances and history, which keep the old brand_id, and hands its PII to a
  -- tenant that never had it.
  if new.brand_id is distinct from old.brand_id and auth.uid() is not null then
    raise exception 'customers.brand_id can only be changed by the engine';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Shift staff read balances for guests they cannot see.
--
-- 0010 narrowed `customers_select` so a shift lead sees only guests who have
-- ordered at a location they are claimed into. These four kept bare
-- `app.is_brand_staff(brand_id)`, so the same session that correctly returned
-- 0 rows for a hidden guest's customer row went on to read that guest's points
-- balance, their stored-value balance, and their referral code -- the last of
-- which is redeemable.
drop policy loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select on public.loyalty_accounts for select
  using (
    exists (select 1 from public.customers c
            where c.id = loyalty_accounts.customer_id and c.user_id = auth.uid())
    or (app.is_brand_staff(brand_id) and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id) and app.customer_ordered_at(customer_id, app.jwt_location_ids()))
  );

drop policy loyalty_events_select on public.loyalty_events;
create policy loyalty_events_select on public.loyalty_events for select
  using (
    exists (select 1 from public.loyalty_accounts a
            join public.customers c on c.id = a.customer_id
            where a.id = loyalty_events.account_id and c.user_id = auth.uid())
    or (app.is_brand_staff(brand_id) and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id) and exists (
          select 1 from public.loyalty_accounts a
          where a.id = loyalty_events.account_id
            and app.customer_ordered_at(a.customer_id, app.jwt_location_ids())))
  );

drop policy stored_value_select on public.stored_value_ledger;
create policy stored_value_select on public.stored_value_ledger for select
  using (
    exists (select 1 from public.customers c
            where c.id = stored_value_ledger.customer_id and c.user_id = auth.uid())
    or (app.is_brand_staff(brand_id) and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id) and app.customer_ordered_at(customer_id, app.jwt_location_ids()))
  );

drop policy referrals_select on public.referrals;
create policy referrals_select on public.referrals for select
  using (
    exists (select 1 from public.customers c
            where c.id = referrals.referrer_customer_id and c.user_id = auth.uid())
    or (app.is_brand_staff(brand_id) and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id) and app.customer_ordered_at(referrer_customer_id, app.jwt_location_ids()))
  );

-- ---------------------------------------------------------------------------
-- 5. A brand set its own platform fee.
--
-- `brands_update` covers the whole row, and three of its columns are rule 3's
-- commercial terms. Executed: a brand owner ran `update public.brands set
-- fee_bps = 0, fee_bps_tier2 = 0, tier_threshold_cents = 0` on their own brand
-- (UPDATE 1), and `packages/engine` computes `app_fee_money` from exactly those
-- columns -- so every subsequent card payment carried a zero platform take.
-- 0019 closed the read side of these columns and left the write side open.
create or replace function app.protect_fee_terms() returns trigger
language plpgsql as $$
begin
  if app.jwt_role() is distinct from 'platform_admin'
     and app.jwt_role() is not null
     and (new.fee_bps is distinct from old.fee_bps
       or new.fee_bps_tier2 is distinct from old.fee_bps_tier2
       or new.tier_threshold_cents is distinct from old.tier_threshold_cents) then
    raise exception 'fee terms are set by the platform operator, not the brand';
  end if;
  return new;
end $$;

drop trigger if exists brands_protect_fee_terms on public.brands;
create trigger brands_protect_fee_terms before update on public.brands
  for each row execute function app.protect_fee_terms();

-- ---------------------------------------------------------------------------
-- 6. Signed-out reads of orders errored instead of returning nothing.
--
-- `customers_select` is a {public} policy, so `anon` evaluates it too, and it
-- calls `app.customer_ordered_at` -- which 0010 granted to `authenticated`
-- only. A signed-out `select count(*) from public.orders` aborted with 42501
-- rather than returning 0 rows, and the metrics views over orders with it. A
-- denial test would have passed for the wrong reason, which is the exact
-- failure mode 0014's own comment was written to eliminate.
grant execute on function app.customer_ordered_at to anon;
