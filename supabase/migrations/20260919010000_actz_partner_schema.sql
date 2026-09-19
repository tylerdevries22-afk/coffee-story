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
