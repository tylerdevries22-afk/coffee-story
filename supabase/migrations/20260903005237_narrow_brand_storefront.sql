-- Narrow the anonymous storefront read to the one brand the caller names.
--
-- `app.brand_storefront_rows()` (0824080728) was `security definer` with no
-- `where` clause, and `public.brand_storefront` published it to `anon`. Any
-- holder of any tenant's publishable key could therefore list every brand on
-- the platform: slug, name, the seven feature flags, and `brand_config` --
-- which carries `business` (legal name, email, phone, website), the tax
-- jurisdictions and the loyalty reward catalogue. None of that is a
-- credential; the disclosure is the *list*, the platform's customer roster
-- readable by any one of its customers.
--
-- docs/AUDIT.md accepted this as a residual while one tenant existed and said
-- to fix it before tenant #2. There are now four tenant folders, so the
-- condition the deferral rested on has expired.
--
-- Clients already filtered by slug or id, but a filter applied after the
-- definer has returned every row is a convenience, not a boundary. The
-- boundary moves into the function: it takes the identifier as an argument and
-- returns at most the one row asked for. Passing neither returns nothing,
-- so a caller that forgets to narrow fails closed rather than open.
--
-- The view cannot survive this -- a view takes no arguments -- so it is
-- dropped rather than left returning zero rows. A missed caller then fails
-- loudly with `42P01` instead of silently rendering an unbranded app.

drop view if exists public.brand_storefront;

create or replace function app.brand_storefront_rows(
  p_slug text,
  p_brand_id uuid
)
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
   where (p_slug is not null and brand.slug = p_slug)
      or (p_brand_id is not null and brand.id = p_brand_id)
   limit 1
$$;
revoke execute on function app.brand_storefront_rows(text, uuid) from public;
grant execute on function app.brand_storefront_rows(text, uuid)
  to anon, authenticated, service_role;

-- The unnarrowed overload is the vulnerability; remove it so nothing can call
-- it back into service.
drop function if exists app.brand_storefront_rows();

-- The public entry point. Security invoker: the narrowing lives in the definer
-- it delegates to, and this wrapper adds no privilege of its own.
create or replace function public.brand_storefront_lookup(
  p_slug text default null,
  p_brand_id uuid default null
)
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
language sql stable security invoker
set search_path = ''
as $$
  select * from app.brand_storefront_rows(p_slug, p_brand_id)
$$;
revoke execute on function public.brand_storefront_lookup(text, uuid) from public;
grant execute on function public.brand_storefront_lookup(text, uuid)
  to anon, authenticated, service_role;

comment on function public.brand_storefront_lookup(text, uuid) is
  'The anonymous storefront bootstrap. Returns at most the one brand named by '
  'slug or id; naming neither returns nothing. Replaces the brand_storefront '
  'view, which returned every brand on the platform.';

-- Readiness chain extension. Stated against the catalog rather than the data:
-- the unnarrowed overload and the view are the exposure, so their continued
-- absence is the contract. A later migration that recreates either -- by
-- restoring an old definition wholesale, say -- fails the release closed.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902220257;
alter function public.platform_release_readiness_20260902220257() set schema app;
revoke all on function app.platform_release_readiness_20260902220257()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902220257() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902220257() <> '20260902220257' then
    raise exception 'module registry backfill prerequisite is incomplete';
  end if;
  if to_regprocedure('app.brand_storefront_rows()') is not null then
    raise exception 'the unnarrowed brand_storefront_rows overload is back';
  end if;
  if to_regprocedure('app.brand_storefront_rows(text, uuid)') is null then
    raise exception 'the narrowed brand_storefront_rows is missing';
  end if;
  if to_regprocedure('public.brand_storefront_lookup(text, uuid)') is null then
    raise exception 'the brand storefront lookup entry point is missing';
  end if;
  if exists (
    select 1 from pg_catalog.pg_views view
    where view.schemaname = 'public' and view.viewname = 'brand_storefront'
  ) then
    raise exception 'the unnarrowed brand_storefront view is back';
  end if;
  return '20260903005237';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
