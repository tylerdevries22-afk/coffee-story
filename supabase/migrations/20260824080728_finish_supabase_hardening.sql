-- Finish the hosted-project hardening against the current Supabase advisors.
-- Privileged projections remain narrow, but their public views now run as the
-- caller and delegate the exceptional reads to unexposed app-schema helpers.

-- A retry after an ambiguous network response must not create a second menu.
create unique index menus_brand_name_idx on public.menus (brand_id, name);

-- Function EXECUTE is granted to PUBLIC by default. Revoking only `anon` left
-- the arrival RPC anonymously callable through PUBLIC's inherited privilege.
revoke execute on function public.mark_order_arrived(uuid)
  from public, anon;
grant execute on function public.mark_order_arrived(uuid)
  to authenticated;

create or replace function app.brand_storefront_rows()
returns table (
  id uuid,
  slug text,
  name text,
  drops boolean,
  catering boolean,
  delivery boolean,
  multi_location boolean,
  sms boolean,
  stored_value boolean,
  referrals boolean,
  brand_config jsonb
)
language sql stable security definer
set search_path = ''
as $$
  select brand.id, brand.slug, brand.name, brand.drops, brand.catering,
         brand.delivery, brand.multi_location, brand.sms,
         brand.stored_value, brand.referrals, brand.brand_config
    from public.brands brand
$$;
revoke execute on function app.brand_storefront_rows() from public;
grant execute on function app.brand_storefront_rows()
  to anon, authenticated, service_role;

create or replace view public.brand_storefront
with (security_barrier = true, security_invoker = true) as
  select * from app.brand_storefront_rows();
grant select on public.brand_storefront to anon, authenticated;
revoke insert, update, delete on public.brand_storefront from anon, authenticated;

create or replace function app.location_square_status_rows()
returns table (
  location_id uuid,
  brand_id uuid,
  merchant_id text,
  expires_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select connection.location_id, connection.brand_id,
         connection.merchant_id, connection.expires_at
    from public.square_connections connection
   where app.is_brand_staff(connection.brand_id)
$$;
revoke execute on function app.location_square_status_rows() from public, anon;
grant execute on function app.location_square_status_rows()
  to authenticated, service_role;

create or replace view public.location_square_status
with (security_barrier = true, security_invoker = true) as
  select * from app.location_square_status_rows();
grant select on public.location_square_status to authenticated;
revoke all on public.location_square_status from anon;
revoke insert, update, delete on public.location_square_status from authenticated;

create or replace function app.board_ticket_rows()
returns table (
  id uuid,
  brand_id uuid,
  location_id uuid,
  daily_number integer,
  guest_label text,
  status app.order_status,
  fulfillment_type app.fulfillment_type,
  channel app.order_channel,
  arrived_at timestamptz,
  loyalty_tier text,
  updated_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select target.id, target.brand_id, target.location_id, target.daily_number,
         target.guest_label, target.status, target.fulfillment_type,
         target.channel, target.arrived_at,
         app.loyalty_tier_for(target.customer_id, target.brand_id),
         target.updated_at
    from public.orders target
   where target.status in ('paid', 'in_progress', 'ready')
     and app.can_read_board(target.brand_id, target.location_id)
$$;
revoke execute on function app.board_ticket_rows() from public;
grant execute on function app.board_ticket_rows()
  to anon, authenticated, service_role;

create or replace view public.board_tickets
with (security_barrier = true, security_invoker = true) as
  select * from app.board_ticket_rows();
grant select on public.board_tickets to authenticated, anon;
revoke insert, update, delete on public.board_tickets from anon, authenticated;

-- This projection needs no privileged base-table access: its underlying RLS
-- already implements the exact owner-or-self rule.
alter view public.loyalty_standing set (security_invoker = true);
