-- 0007: RLS on every table (rule 1). Policies lean on the 0001 helpers; the
-- service role (the engine) bypasses RLS entirely, which is where writes that
-- move money happen. Client-side writes are limited to what a signed-in
-- person may legitimately do directly.

-- brands ---------------------------------------------------------------
alter table public.brands enable row level security;

create policy brands_select on public.brands for select
  using (app.is_platform_admin() or id = app.jwt_brand_id());
create policy brands_insert on public.brands for insert
  with check (app.is_platform_admin());
create policy brands_update on public.brands for update
  using (app.is_brand_owner(id)) with check (app.is_brand_owner(id));
create policy brands_delete on public.brands for delete
  using (app.is_platform_admin());

-- locations ------------------------------------------------------------
alter table public.locations enable row level security;

-- Guests browse a shop's locations before signing in, and the customer app
-- may run with no brand claim at all: location identity, address and hours
-- are public storefront facts.
create policy locations_select on public.locations for select using (true);
create policy locations_write on public.locations for insert
  with check (app.is_brand_owner(brand_id));
create policy locations_update on public.locations for update
  using (app.is_brand_owner(brand_id) or app.at_location(brand_id, id))
  with check (app.is_brand_owner(brand_id) or app.at_location(brand_id, id));
create policy locations_delete on public.locations for delete
  using (app.is_brand_owner(brand_id));

-- brand_users ----------------------------------------------------------
alter table public.brand_users enable row level security;

create policy brand_users_select on public.brand_users for select
  using (app.is_brand_owner(brand_id) or user_id = auth.uid());
create policy brand_users_write on public.brand_users for insert
  with check (app.is_brand_owner(brand_id));
create policy brand_users_update on public.brand_users for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy brand_users_delete on public.brand_users for delete
  using (app.is_brand_owner(brand_id));

-- square_connections: no policies at all. RLS enabled + zero policies means
-- no client role can read or write a row; only the engine (service role,
-- which bypasses RLS) touches tokens. Managers see connection status through
-- the location_square_status view below.
alter table public.square_connections enable row level security;

-- menus / categories / items / drops ------------------------------------
alter table public.menus enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.drops enable row level security;

-- A menu is a storefront: published rows are world-readable; staff also see
-- their own drafts.
create policy menus_select on public.menus for select
  using (is_published or app.is_brand_staff(brand_id));
create policy menus_write on public.menus for insert
  with check (app.is_brand_owner(brand_id));
create policy menus_update on public.menus for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy menus_delete on public.menus for delete
  using (app.is_brand_owner(brand_id));

create policy menu_categories_select on public.menu_categories for select
  using (exists (select 1 from public.menus m
                 where m.id = menu_id and (m.is_published or app.is_brand_staff(m.brand_id))));
create policy menu_categories_write on public.menu_categories for insert
  with check (app.is_brand_owner(brand_id));
create policy menu_categories_update on public.menu_categories for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy menu_categories_delete on public.menu_categories for delete
  using (app.is_brand_owner(brand_id));

create policy menu_items_select on public.menu_items for select
  using (exists (select 1 from public.menus m
                 where m.id = menu_id and (m.is_published or app.is_brand_staff(m.brand_id))));
create policy menu_items_write on public.menu_items for insert
  with check (app.is_brand_owner(brand_id));
-- 86ing an item is a shift-floor action: staff at the location's brand may
-- update items; owners everything else. Column-level nuance (staff limited to
-- is_86d/availability) is enforced by the operator app and revisited when
-- Postgres column grants land in Phase 7's hardening pass.
create policy menu_items_update on public.menu_items for update
  using (app.is_brand_staff(brand_id)) with check (app.is_brand_staff(brand_id));
create policy menu_items_delete on public.menu_items for delete
  using (app.is_brand_owner(brand_id));

create policy drops_select on public.drops for select
  using (status in ('scheduled', 'live', 'ended') or app.is_brand_staff(brand_id));
create policy drops_write on public.drops for insert
  with check (app.is_brand_owner(brand_id));
create policy drops_update on public.drops for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy drops_delete on public.drops for delete
  using (app.is_brand_owner(brand_id));

-- customers --------------------------------------------------------------
alter table public.customers enable row level security;

create policy customers_select on public.customers for select
  using (user_id = auth.uid() or app.is_brand_staff(brand_id));
create policy customers_insert on public.customers for insert
  with check (user_id = auth.uid() and brand_id = app.jwt_brand_id());
create policy customers_update on public.customers for update
  using (user_id = auth.uid() or app.is_brand_staff(brand_id))
  with check (user_id = auth.uid() or app.is_brand_staff(brand_id));

-- loyalty ----------------------------------------------------------------
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_events enable row level security;

-- Balances move only through the engine (earn on paid, reverse on refund,
-- redeem inside checkout): read-only from every client role.
create policy loyalty_accounts_select on public.loyalty_accounts for select
  using (app.is_brand_staff(brand_id) or exists (
    select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid()));
create policy loyalty_events_select on public.loyalty_events for select
  using (app.is_brand_staff(brand_id) or exists (
    select 1 from public.loyalty_accounts a
    join public.customers c on c.id = a.customer_id
    where a.id = account_id and c.user_id = auth.uid()));

-- stored value -----------------------------------------------------------
alter table public.stored_value_ledger enable row level security;

create policy stored_value_select on public.stored_value_ledger for select
  using (app.is_brand_staff(brand_id) or exists (
    select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid()));

-- referrals ----------------------------------------------------------------
alter table public.referrals enable row level security;

create policy referrals_select on public.referrals for select
  using (app.is_brand_staff(brand_id) or exists (
    select 1 from public.customers c where c.id = referrer_customer_id and c.user_id = auth.uid()));

-- orders -------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_events enable row level security;

create policy orders_select on public.orders for select
  using (
    app.is_brand_owner(brand_id)
    or app.at_location(brand_id, location_id)
    or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid())
  );
-- Order creation and payment go through the engine (service role): a client
-- cannot insert an order row directly, which is what makes the totals
-- trustworthy. Status transitions from the shop floor are inserts into
-- order_events by location staff; the trigger projects them.
create policy order_events_select on public.order_events for select
  using (
    app.is_brand_owner(brand_id)
    or exists (select 1 from public.orders o
               where o.id = order_id
                 and (app.at_location(o.brand_id, o.location_id)
                      or exists (select 1 from public.customers c
                                 where c.id = o.customer_id and c.user_id = auth.uid()))));
create policy order_events_insert on public.order_events for insert
  with check (
    source = 'operator'
    and type in ('in_progress', 'ready', 'picked_up', 'cancelled')
    and actor_user_id = auth.uid()
    and exists (select 1 from public.orders o
                where o.id = order_id and app.at_location(o.brand_id, o.location_id)));

-- platform_fees: the platform's own revenue view (rule 3). Nobody but the
-- platform reads it; brands see their costs on their Square statements.
alter table public.platform_fees enable row level security;
create policy platform_fees_select on public.platform_fees for select
  using (app.is_platform_admin());

-- campaigns ---------------------------------------------------------------
alter table public.campaigns enable row level security;
create policy campaigns_select on public.campaigns for select
  using (app.is_brand_staff(brand_id));
create policy campaigns_write on public.campaigns for insert
  with check (app.is_brand_owner(brand_id));
create policy campaigns_update on public.campaigns for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy campaigns_delete on public.campaigns for delete
  using (app.is_brand_owner(brand_id));
