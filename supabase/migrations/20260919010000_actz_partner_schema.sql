-- App Factory ↔ ACTZ partner bridge (Wave 1 schema only).
-- Organizations in this schema are public.brands.
-- Enrollment keys mirror elevate-*: actz-ordering, actz-tenant-pack.
-- Do not apply to production from this PR alone.

alter table public.brands
  add column if not exists actz_provider_org_id text;

comment on column public.brands.actz_provider_org_id is
  'Nullable ACTZ provider org id (provider_profiles.profile_id as text). Unique when set.';

create unique index if not exists brands_actz_provider_org_id_uidx
  on public.brands (actz_provider_org_id)
  where actz_provider_org_id is not null;

-- Enrollment table already constrains key shape; assert it exists and document ACTZ keys.
do $$
begin
  if to_regclass('public.integration_brand_enrollments') is null then
    raise exception 'integration_brand_enrollments missing; cannot register actz enrollment keys';
  end if;
end $$;

comment on table public.integration_brand_enrollments is
  'Brands that opted a platform integration into reading their summary. Never an entitlement to write. Reserved keys include elevate-ordering, elevate-tenant-pack, actz-ordering, actz-tenant-pack.';

-- Assert ACTZ partner column + unique index stay fail-closed for clients.
create function app.assert_actz_partner_schema()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'brands'
      and column_name = 'actz_provider_org_id'
  ) then
    raise exception 'brands.actz_provider_org_id missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'brands'
      and indexname = 'brands_actz_provider_org_id_uidx'
  ) then
    raise exception 'brands.actz_provider_org_id unique index missing';
  end if;
  if to_regclass('public.integration_brand_enrollments') is null then
    raise exception 'integration_brand_enrollments missing';
  end if;
end $$;

revoke all on function app.assert_actz_partner_schema() from public, anon, authenticated;
grant execute on function app.assert_actz_partner_schema() to service_role;

select app.register_release(
  '20260919010000',
  'ACTZ partner: brands.actz_provider_org_id + reserved actz-ordering/actz-tenant-pack enrollment keys',
  'app.assert_actz_partner_schema()'::regprocedure
);

