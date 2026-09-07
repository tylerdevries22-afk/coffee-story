-- Signed-in guests use the same sanitized catalog lookup as logged-out
-- guests. Published status alone must not expose another tenant's staff IDs.
-- This changes policies only; table/RPC shapes and generated types are unchanged.
alter policy catalog_releases_read on public.catalog_releases to authenticated
  using (
    app.is_brand_owner(brand_id)
    or (status = 'published' and app.is_brand_staff(brand_id))
  );

-- Anonymous realtime subscribers retain their existing key-only grants.
-- Signed-in guests and staff keep signals for their own active brand; platform
-- admins retain the platform view. Cross-brand public menus still use the
-- explicit published_catalog_lookup, which omits creator metadata.
alter policy catalog_publications_read on public.catalog_publications
  using (
    (select auth.jwt() ->> 'role') = 'anon'
    or (select app.is_platform_admin())
    or (brand_id = (select app.jwt_brand_id()) and app.brand_is_active(brand_id))
  );

alter policy brand_config_signals_select on public.brand_config_signals
  using (
    (select auth.jwt() ->> 'role') = 'anon'
    or (select app.is_platform_admin())
    or (brand_id = (select app.jwt_brand_id()) and app.brand_is_active(brand_id))
  );

alter policy location_setting_signals_select on public.location_setting_signals
  using (
    (select auth.jwt() ->> 'role') = 'anon'
    or (select app.is_platform_admin())
    or (brand_id = (select app.jwt_brand_id()) and app.brand_is_active(brand_id))
  );

-- Reuse the readiness assertion that pins anonymous lookup and realtime grants.
-- Cross-tenant authenticated behavior is exercised against PostgreSQL by
-- catalog-metadata-rls.test.ts, including owner/staff/guest/admin/anon principals.
select app.register_release(
  '20260907204500',
  'scope authenticated catalog and signal metadata to the active tenant',
  'app.assert_anon_reads_are_scoped()'::regprocedure
);
