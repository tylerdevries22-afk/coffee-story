-- Linked DBs that applied the first 210000 body still register
-- app.assert_publish_grant_and_protect_identity, which requires the legacy
-- publisher grant. Replace that assertion with a no-op and prefer the nested
-- protect-identity check.

create or replace function app.assert_publish_grant_and_protect_identity()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  -- Intentionally empty: the legacy publisher must stay unexposed.
  return;
end $$;

revoke all on function app.assert_publish_grant_and_protect_identity()
  from public, anon, authenticated;
grant execute on function app.assert_publish_grant_and_protect_identity()
  to service_role;

create or replace function app.assert_protect_connector_contract_identity_nested()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('app.protect_connector_contract_identity()') is null then
    raise exception 'protect_connector_contract_identity is missing';
  end if;
end $$;

revoke all on function app.assert_protect_connector_contract_identity_nested()
  from public, anon, authenticated;
grant execute on function app.assert_protect_connector_contract_identity_nested()
  to service_role;

update app.release_assertions
set assertion = 'app.assert_protect_connector_contract_identity_nested()'
where release = '20260911210000';

select app.register_release(
  '20260911230000',
  'drop stale publish-grant release assertion',
  'app.assert_legacy_publish_unexposed()'::regprocedure
);
