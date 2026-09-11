-- Cover every tenant-package foreign key with its own leading-column index.
-- The package tables grow with every immutable release and access event, so
-- parent deletes and integrity checks must never scan their full histories.
create index tenant_package_files_brand_id_idx
  on public.tenant_package_files (brand_id);
create index tenant_package_files_release_brand_idx
  on public.tenant_package_files (package_release_id, brand_id);
create index tenant_package_publications_release_brand_idx
  on public.tenant_package_publications (current_release_id, brand_id);
create index tenant_package_access_events_actor_id_idx
  on public.tenant_package_access_events (actor_id);
create index tenant_package_access_events_release_brand_idx
  on public.tenant_package_access_events (package_release_id, brand_id);
create index tenant_package_access_events_file_brand_idx
  on public.tenant_package_access_events (file_id, brand_id);
create index tenant_package_rate_limits_brand_id_idx
  on app_private.tenant_package_rate_limits (brand_id);

create or replace function app.assert_tenant_package_foreign_key_indexes()
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  required_index text;
begin
  foreach required_index in array array[
    'public.tenant_package_files_brand_id_idx',
    'public.tenant_package_files_release_brand_idx',
    'public.tenant_package_publications_release_brand_idx',
    'public.tenant_package_access_events_actor_id_idx',
    'public.tenant_package_access_events_release_brand_idx',
    'public.tenant_package_access_events_file_brand_idx',
    'app_private.tenant_package_rate_limits_brand_id_idx'
  ] loop
    if pg_catalog.to_regclass(required_index) is null then
      raise exception 'required tenant-package foreign-key index % is missing', required_index;
    end if;
  end loop;
end
$$;

revoke all on function app.assert_tenant_package_foreign_key_indexes()
  from public, anon, authenticated;
grant execute on function app.assert_tenant_package_foreign_key_indexes()
  to service_role;

select app.register_release(
  '20260908224000',
  'cover tenant package foreign keys',
  'app.assert_tenant_package_foreign_key_indexes()'::regprocedure
);
