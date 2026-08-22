-- 0010: closes the three holes the production audit found in 0007, and the
-- staff-can-rewrite-prices gap its own comment deferred.

-- 1. order_events_insert never pinned the row's own brand_id to the order's:
--    location staff could forge brand_id on a legitimate event and change who
--    the owner-branch of order_events_select shows the snapshot to. Also adds
--    'paid' to the operator-insertable set: with the pay_at_pickup tender the
--    shop floor asserts payment at handoff.
drop policy order_events_insert on public.order_events;
create policy order_events_insert on public.order_events for insert
  with check (
    source = 'operator'
    and type in ('paid', 'in_progress', 'ready', 'picked_up', 'cancelled')
    and actor_user_id = auth.uid()
    and exists (select 1 from public.orders o
                where o.id = order_id
                  and o.brand_id = order_events.brand_id
                  and app.at_location(o.brand_id, o.location_id)));

-- 2. customers_update let any brand staff set any column including user_id --
--    re-pointing a customer row (and its loyalty and stored-value balances)
--    at their own auth.uid(). Policies cannot compare OLD and NEW, so the
--    identity column is frozen by a trigger. The service role carries no sub
--    claim, so auth.uid() is null for the engine and backfills stay free to
--    correct identity.
create or replace function app.protect_customer_identity() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id and auth.uid() is not null then
    raise exception 'customers.user_id can only be changed by the engine';
  end if;
  return new;
end $$;

create trigger customers_protect_identity before update on public.customers
  for each row execute function app.protect_customer_identity();

-- 3. customers_select handed every staff-role user the whole brand's PII.
--    Shift staff now see themselves, plus only guests with an order at a
--    location they are claimed into; managers and owners keep brand scope.
drop policy customers_select on public.customers;
create policy customers_select on public.customers for select
  using (
    user_id = auth.uid()
    or (app.is_brand_staff(brand_id) and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id) and exists (
      select 1 from public.orders o
      where o.customer_id = customers.id
        and o.location_id = any (app.jwt_location_ids())))
  );

-- Same narrowing on the update side: staff edits (notes, opt-ins) follow the
-- same visibility, and the identity trigger above guards the one dangerous
-- column regardless.
drop policy customers_update on public.customers;
create policy customers_update on public.customers for update
  using (
    user_id = auth.uid()
    or (app.is_brand_staff(brand_id) and app.jwt_role() in ('brand_owner', 'location_manager', 'platform_admin'))
    or (app.is_brand_staff(brand_id) and exists (
      select 1 from public.orders o
      where o.customer_id = customers.id
        and o.location_id = any (app.jwt_location_ids())))
  )
  with check (app.is_brand_staff(brand_id) or user_id = auth.uid());

-- 4. The column-level nuance 0007 deferred: shift staff may flip is_86d and
--    is_listed, nothing else. Managers and owners are unrestricted; the
--    service role (auth.uid() null, no jwt role) is unrestricted.
create or replace function app.restrict_staff_menu_edit() returns trigger
language plpgsql as $$
begin
  if app.jwt_role() = 'staff' then
    if new.slug is distinct from old.slug
      or new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.base_price_cents is distinct from old.base_price_cents
      or new.sizes is distinct from old.sizes
      or new.modifiers is distinct from old.modifiers
      or new.availability is distinct from old.availability
      or new.image_url is distinct from old.image_url
      or new.category_id is distinct from old.category_id
      or new.menu_id is distinct from old.menu_id
      or new.brand_id is distinct from old.brand_id
      or new.sort_order is distinct from old.sort_order then
      raise exception 'staff may only change is_86d and is_listed on menu items';
    end if;
  end if;
  return new;
end $$;

create trigger menu_items_staff_columns before update on public.menu_items
  for each row execute function app.restrict_staff_menu_edit();
