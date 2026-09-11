-- 210000 briefly re-granted service_role execute on the legacy publisher;
-- compensation requires that function stay unexposed. Revoke again.

revoke all on function public.publish_tenant_package(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function app.assert_legacy_publish_unexposed()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.has_function_privilege(
    'service_role',
    'public.publish_tenant_package(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.publish_tenant_package(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.publish_tenant_package(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'legacy tenant package publication function is exposed';
  end if;
end $$;

revoke all on function app.assert_legacy_publish_unexposed()
  from public, anon, authenticated;
grant execute on function app.assert_legacy_publish_unexposed() to service_role;

select app.register_release(
  '20260911220000',
  'keep legacy publish_tenant_package unexposed',
  'app.assert_legacy_publish_unexposed()'::regprocedure
);
