-- Cache the complete JWT before extracting its role. Besides using one
-- InitPlan per statement, this form survives PostgreSQL's expression printer
-- in the shape recognized by the hosted auth_rls_initplan advisor.
alter policy catalog_publications_read on public.catalog_publications
  using (
    (select auth.jwt()) ->> 'role' = 'anon'
    or (select app.is_platform_admin())
    or (brand_id = (select app.jwt_brand_id()) and app.brand_is_active(brand_id))
  );

alter policy brand_config_signals_select on public.brand_config_signals
  using (
    (select auth.jwt()) ->> 'role' = 'anon'
    or (select app.is_platform_admin())
    or (brand_id = (select app.jwt_brand_id()) and app.brand_is_active(brand_id))
  );

alter policy location_setting_signals_select on public.location_setting_signals
  using (
    (select auth.jwt()) ->> 'role' = 'anon'
    or (select app.is_platform_admin())
    or (brand_id = (select app.jwt_brand_id()) and app.brand_is_active(brand_id))
  );

select app.register_release(
  '20260907205500',
  'cache catalog signal claims in advisor-compatible initplans',
  'app.assert_anon_reads_are_scoped()'::regprocedure
);
