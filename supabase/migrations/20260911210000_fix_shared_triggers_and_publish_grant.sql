-- Shared protect trigger must not touch NEW.provider_id on certifications
-- (PL/pgSQL still resolves the field when the branch is skipped via AND).

create or replace function app.protect_connector_contract_identity()
returns trigger language plpgsql security invoker set search_path = '' as $lifecycle$
begin
  if tg_table_name = 'connector_capabilities' then
    if new.provider_id is distinct from old.provider_id
      or new.capability_key is distinct from old.capability_key then
      raise exception using errcode = '23514',
        message = 'connector_capability_identity_immutable';
    end if;
  elsif tg_table_name = 'connector_certifications' then
    if new.capability_id is distinct from old.capability_id
      or new.environment is distinct from old.environment
      or new.contract_version is distinct from old.contract_version then
      raise exception using errcode = '23514',
        message = 'connector_certification_identity_immutable';
    end if;
  end if;
  return new;
end $lifecycle$;

revoke all on function app.protect_connector_contract_identity()
  from public, anon, authenticated, service_role;

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

select app.register_release(
  '20260911210000',
  'nested protect-identity IF for certifications without provider_id',
  'app.assert_protect_connector_contract_identity_nested()'::regprocedure
);
