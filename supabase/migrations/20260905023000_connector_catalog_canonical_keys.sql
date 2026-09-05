-- Keep the tenant registry keys identical to the public MCP catalog IDs.
-- Installations reference provider UUIDs, so this rename preserves every tenant link.
update public.connector_registry
set provider_key = case provider_key
  when 'google' then 'google-suite'
  when 'quickbooks' then 'quickbooks-online'
  else provider_key
end,
updated_at = now()
where provider_key in ('google', 'quickbooks');

create or replace function app.assert_connector_catalog_canonical_keys()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if exists (
    select 1
    from public.connector_registry
    where provider_key in ('google', 'quickbooks')
  ) then
    raise exception 'legacy connector provider keys remain registered';
  end if;
end $$;
revoke all on function app.assert_connector_catalog_canonical_keys()
  from public, anon, authenticated;
grant execute on function app.assert_connector_catalog_canonical_keys()
  to service_role;

select app.register_release(
  '20260905023000',
  'connector registry keys match the canonical MCP catalog identifiers',
  'app.assert_connector_catalog_canonical_keys()'::regprocedure
);
