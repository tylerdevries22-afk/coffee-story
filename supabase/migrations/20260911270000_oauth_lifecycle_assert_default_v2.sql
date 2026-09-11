-- assert_connector_credential_lifecycle still required column_default = '1'.
-- The v2 default is already live; update the assertion so readiness matches.

CREATE OR REPLACE FUNCTION app.assert_connector_credential_lifecycle()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_signature text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'square_connections'
      and column_name = 'oauth_scope_contract_version'
      and is_nullable = 'NO' and column_default = '2'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'location_square_status'
      and column_name = 'oauth_scope_contract_version'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'connector_oauth_states'
      and column_name = 'superseded_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'connector_oauth_states'
      and column_name = 'completion_key'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'connector_oauth_states'
      and column_name = 'consume_key'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'connector_oauth_states'
      and column_name = 'processing_lease_token'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credential_references'
      and column_name = 'credential_generation'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credential_references'
      and column_name = 'external_account_fingerprint'
  ) or pg_catalog.to_regclass(
    'app_private.connector_oauth_lifecycle_jobs'
  ) is null then
    raise exception 'connector credential lifecycle columns are missing';
  end if;
  if pg_catalog.to_regprocedure(
      'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)'
    ) is not null then
    raise exception 'non-idempotent connector completion overload remains';
  end if;
  if pg_catalog.to_regprocedure(
      'public.consume_connector_oauth_state(text,uuid,text)'
    ) is not null then
    raise exception 'non-idempotent connector consume overload remains';
  end if;

  foreach v_signature in array array[
    'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,uuid,jsonb,text,text[],timestamptz)',
    'public.queue_connector_oauth_compensation(uuid,uuid,text,uuid,uuid,uuid,jsonb,text,text[],timestamptz,text,jsonb)',
    'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
    'public.cancel_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
    'public.reconcile_connector_credential_status(timestamptz,integer)',
    'public.disconnect_connector_oauth_connection(uuid,text,uuid)',
    'public.start_connector_oauth_credential_rotation(uuid,uuid,timestamptz)',
    'public.cancel_connector_oauth_credential_rotation(uuid,uuid,timestamptz)',
    'public.claim_connector_oauth_identities(timestamptz,integer,integer)',
    'public.rotate_connector_oauth_identity_credential(uuid,uuid,jsonb,timestamptz,timestamptz)',
    'public.complete_connector_oauth_identity(uuid,uuid,text,timestamptz)',
    'public.fail_connector_oauth_identity(uuid,uuid,text,boolean,timestamptz)',
    'public.claim_connector_oauth_revocations(timestamptz,integer,integer)',
    'public.rotate_connector_oauth_revocation_credential(uuid,uuid,jsonb,timestamptz,timestamptz)',
    'public.complete_connector_oauth_revocation(uuid,uuid,timestamptz)',
    'public.fail_connector_oauth_revocation(uuid,uuid,text,boolean,timestamptz)',
    'public.claim_connector_oauth_refreshes(timestamptz,integer,integer)',
    'public.complete_connector_oauth_refresh(uuid,uuid,jsonb,timestamptz,timestamptz)',
    'public.fail_connector_oauth_refresh(uuid,uuid,text,boolean,timestamptz)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'connector credential lifecycle RPC is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'connector credential lifecycle RPC is client reachable: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'connector credential lifecycle RPC is unavailable: %', v_signature;
    end if;
  end loop;
  if has_function_privilege('service_role',
      'public.store_connector_secret(uuid,text,text,text,text[],timestamptz)',
      'execute'
    ) or has_function_privilege('service_role',
      'public.revoke_connector_secret(uuid,uuid)', 'execute'
    ) or has_function_privilege('service_role',
      'public.resolve_connector_secret(uuid,uuid)', 'execute'
    ) or has_function_privilege('service_role',
      'public.register_square_connector(uuid,uuid,uuid,text,text,text,timestamptz,uuid)',
      'execute'
    ) then
    raise exception 'connector Vault mutation bypass remains executable';
  end if;
  if has_table_privilege('service_role',
      'app_private.connector_oauth_lifecycle_jobs',
      'select,insert,update,delete,truncate'
    ) or has_table_privilege('service_role',
      'app_private.connector_oauth_states',
      'select,insert,update,delete,truncate'
    ) or has_table_privilege('service_role',
      'app_private.connector_oauth_grant_namespaces',
      'select,insert,update,delete,truncate'
    ) or has_table_privilege('authenticated',
      'app_private.connector_oauth_lifecycle_jobs', 'select'
    ) then
    raise exception 'connector OAuth private state is directly reachable';
  end if;
  if has_table_privilege('service_role', 'public.credential_references',
      'insert,update,delete,truncate'
    ) or has_table_privilege('service_role', 'public.connector_installations',
      'insert,update,delete,truncate'
    ) or not has_table_privilege('service_role',
      'public.credential_references', 'select'
    ) or not has_table_privilege('service_role',
      'public.connector_installations', 'select'
    ) then
    raise exception 'connector lifecycle table privileges are unsafe';
  end if;
  if pg_catalog.to_regclass(
      'app_private.connector_oauth_lifecycle_jobs_due_idx'
    ) is null or not exists (
      select 1 from pg_catalog.pg_trigger trigger
      where trigger.tgrelid = 'public.connector_registry'::regclass
        and trigger.tgname = 'connector_registry_protect_identity'
        and not trigger.tgisinternal
    ) then
    raise exception 'connector lifecycle guard or queue index is missing';
  end if;
end $function$;

revoke all on function app.assert_connector_credential_lifecycle()
  from public, anon, authenticated;
grant execute on function app.assert_connector_credential_lifecycle()
  to service_role;

select app.register_release(
  '20260911270000',
  'lifecycle assertion expects OAuth scope contract default 2',
  'app.assert_connector_credential_lifecycle()'::regprocedure
);
