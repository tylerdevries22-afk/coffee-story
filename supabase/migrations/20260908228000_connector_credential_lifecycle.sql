-- Make OAuth connection health derive from durable credential evidence, add a
-- tenant-authorized disconnect boundary, and retire pre-contract Square grants.

alter table public.square_connections
  add column if not exists oauth_scope_contract_version integer not null default 1;
do $lifecycle$ begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.square_connections'::regclass
      and conname = 'square_connections_oauth_scope_contract_version_positive'
  ) then
    alter table public.square_connections
      add constraint square_connections_oauth_scope_contract_version_positive
      check (oauth_scope_contract_version > 0);
  end if;
end $lifecycle$;

comment on column public.square_connections.oauth_scope_contract_version is
  'Scope contract proven when Square issued this grant. Version 2 includes PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS.';

alter table app_private.connector_oauth_states
  add column superseded_at timestamptz
    check (superseded_at is null or superseded_at >= created_at);

alter table public.connector_registry
  add column oauth_lifecycle_managed boolean not null default false,
  add column oauth_refresh_managed boolean not null default false,
  add column oauth_revocation_scope text,
  add column oauth_grant_namespace text;

update public.connector_registry provider set
  oauth_lifecycle_managed = true,
  oauth_refresh_managed = provider.provider_key in (
    'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok'
  ),
  oauth_revocation_scope = 'grant',
  oauth_grant_namespace = case
    when provider.provider_key in ('google-suite', 'youtube')
      then 'google-oauth-project'
    else provider.provider_key
  end
where provider.provider_key in (
  'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok',
  'stripe', 'meta-business-suite'
);

alter table public.connector_registry
  add constraint connector_registry_oauth_lifecycle_contract check (
    (not oauth_lifecycle_managed and not oauth_refresh_managed
      and oauth_revocation_scope is null and oauth_grant_namespace is null)
    or (oauth_lifecycle_managed
      and oauth_revocation_scope in ('credential', 'grant')
      and oauth_grant_namespace ~ '^[a-z][a-z0-9_-]{0,62}$')
  ),
  add constraint connector_registry_oauth_refresh_requires_lifecycle check (
    not oauth_refresh_managed or oauth_lifecycle_managed
  );

create table app_private.connector_oauth_grant_namespaces (
  namespace text primary key
    check (namespace ~ '^[a-z][a-z0-9_-]{0,62}$')
);
insert into app_private.connector_oauth_grant_namespaces (namespace)
select distinct provider.oauth_grant_namespace
from public.connector_registry provider
where provider.oauth_lifecycle_managed;
alter table app_private.connector_oauth_grant_namespaces enable row level security;
alter table app_private.connector_oauth_grant_namespaces force row level security;
revoke all on table app_private.connector_oauth_grant_namespaces
  from public, anon, authenticated, service_role;

create function app.ensure_connector_oauth_grant_namespace()
returns trigger language plpgsql security definer set search_path = '' as $lifecycle$
begin
  if new.oauth_lifecycle_managed then
    insert into app_private.connector_oauth_grant_namespaces (namespace)
    values (new.oauth_grant_namespace) on conflict (namespace) do nothing;
  end if;
  return new;
end $lifecycle$;
revoke all on function app.ensure_connector_oauth_grant_namespace()
  from public, anon, authenticated, service_role;
create trigger connector_registry_ensure_oauth_grant_namespace
  after insert on public.connector_registry for each row
  execute function app.ensure_connector_oauth_grant_namespace();

alter table public.credential_references
  add column credential_generation bigint not null default 1
    constraint credential_references_generation_positive
    check (credential_generation > 0),
  add column external_account_fingerprint text
    constraint credential_references_external_account_fingerprint_check
    check (external_account_fingerprint is null
      or external_account_fingerprint ~ '^[0-9a-f]{64}$');
create index credential_references_external_account_idx
  on public.credential_references (external_account_fingerprint, provider_id)
  where external_account_fingerprint is not null;

create function app.connector_external_account_fingerprint(
  p_provider_id uuid,
  p_credential_text text
) returns text
language plpgsql stable security definer set search_path = '' as $lifecycle$
declare
  v_account_id text;
  v_credential jsonb;
  v_grant_namespace text;
begin
  begin
    v_credential := p_credential_text::jsonb;
  exception when invalid_text_representation then
    return null;
  end;
  if jsonb_typeof(v_credential->'external_account_id') is distinct from 'string'
    or octet_length(v_credential->>'external_account_id') not between 1 and 512 then
    return null;
  end if;
  v_account_id := v_credential->>'external_account_id';
  select provider.oauth_grant_namespace into v_grant_namespace
  from public.connector_registry provider
  where provider.id = p_provider_id and provider.oauth_lifecycle_managed;
  if v_grant_namespace is null then return null; end if;
  return pg_catalog.encode(public.digest(
    jsonb_build_array(v_grant_namespace, v_account_id)::text, 'sha256'
  ), 'hex');
end $lifecycle$;
revoke all on function app.connector_external_account_fingerprint(uuid, text)
  from public, anon, authenticated, service_role;

create function app.try_connector_credential_json(p_credential_text text)
returns jsonb
language plpgsql immutable security invoker set search_path = '' as $lifecycle$
declare
  v_credential jsonb;
begin
  begin
    v_credential := p_credential_text::jsonb;
  exception when invalid_text_representation then
    return null;
  end;
  if jsonb_typeof(v_credential) is distinct from 'object' then
    return null;
  end if;
  return v_credential;
end $lifecycle$;
revoke all on function app.try_connector_credential_json(text)
  from public, anon, authenticated, service_role;

update public.credential_references reference set
  external_account_fingerprint = app.connector_external_account_fingerprint(
    reference.provider_id, secret.decrypted_secret
  )
from vault.decrypted_secrets secret,
  public.connector_registry provider
where secret.id = reference.vault_secret_id
  and provider.id = reference.provider_id
  and provider.oauth_lifecycle_managed
  and reference.external_account_fingerprint is null
  and app.connector_external_account_fingerprint(
    reference.provider_id, secret.decrypted_secret
  ) is not null;

alter table app_private.connector_oauth_states
  add column consume_key uuid,
  add column processing_lease_token uuid,
  add column processing_lease_expires_at timestamptz,
  add column processing_generation bigint not null default 0
    check (processing_generation >= 0),
  add column exchange_attempt_key uuid,
  add column exchange_started_at timestamptz,
  add column provider_contract_version text,
  add column completion_key uuid,
  add column completed_reference_id uuid,
  add column completion_fingerprint text,
  add column completion_outcome text
    check (completion_outcome is null
      or completion_outcome in ('connected', 'cleanup_queued')),
  add constraint connector_oauth_states_completion_pair check (
    (completion_key is null) = (completed_reference_id is null)
      and (completion_key is null) = (completion_fingerprint is null)
      and (completion_key is null) = (completion_outcome is null)
      and (completion_fingerprint is null
        or completion_fingerprint ~ '^[0-9a-f]{64}$')
  ),
  add constraint connector_oauth_states_processing_pair check (
    (processing_lease_token is null) = (processing_lease_expires_at is null)
      and (exchange_attempt_key is null) = (exchange_started_at is null)
      and (exchange_started_at is null or processing_lease_token is not null)
  ),
  add constraint connector_oauth_states_completed_reference_fk
    foreign key (completed_reference_id, brand_id)
    references public.credential_references (id, brand_id) on delete restrict;

create unique index connector_oauth_states_completion_key_idx
  on app_private.connector_oauth_states (completion_key)
  where completion_key is not null;
create index connector_oauth_states_completed_reference_idx
  on app_private.connector_oauth_states (completed_reference_id, brand_id)
  where completed_reference_id is not null;
create unique index connector_oauth_states_consume_key_idx
  on app_private.connector_oauth_states (consume_key)
  where consume_key is not null;

create table app_private.connector_oauth_lifecycle_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  installation_id uuid not null,
  credential_reference_id uuid not null,
  provider_id uuid not null references public.connector_registry (id) on delete restrict,
  operation text not null check (operation in ('identify', 'refresh', 'revoke')),
  state text not null default 'pending' check (state in (
    'pending', 'leased', 'succeeded', 'permanent_failure', 'cancelled'
  )),
  credential_generation bigint not null check (credential_generation > 0),
  attempt_count integer not null default 0 check (attempt_count between 0 and 50),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  lease_rotation_started_at timestamptz,
  lease_rotation_fingerprint text check (
    lease_rotation_fingerprint is null
      or lease_rotation_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  rotation_replay_deadline timestamptz,
  last_finished_lease_token uuid,
  last_finished_outcome text check (
    last_finished_outcome is null
      or last_finished_outcome in ('completed', 'failed', 'compensated')
  ),
  last_finished_fingerprint text check (
    last_finished_fingerprint is null
      or last_finished_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  identity_finished_lease_token uuid,
  identity_finished_fingerprint text check (
    identity_finished_fingerprint is null
      or identity_finished_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  identity_hint jsonb not null default '{}'::jsonb check (
    jsonb_typeof(identity_hint) = 'object' and pg_column_size(identity_hint) <= 2048
  ),
  cancel_requested boolean not null default false,
  is_compensation boolean not null default false,
  intake_key uuid,
  intake_fingerprint text check (
    intake_fingerprint is null or intake_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  cleanup_reason text check (
    cleanup_reason is null or cleanup_reason ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  foreign key (credential_reference_id, brand_id)
    references public.credential_references (id, brand_id) on delete cascade,
  unique (credential_reference_id, operation),
  check ((state = 'leased') = (lease_token is not null and lease_expires_at is not null)),
  check ((intake_key is null) = (intake_fingerprint is null)),
  check (completed_at is null or state in ('succeeded', 'permanent_failure', 'cancelled'))
);

create index connector_oauth_lifecycle_jobs_due_idx
  on app_private.connector_oauth_lifecycle_jobs (
    operation, next_attempt_at, created_at, id
  ) where state in ('pending', 'leased');
create index connector_oauth_lifecycle_jobs_installation_idx
  on app_private.connector_oauth_lifecycle_jobs (installation_id, brand_id);
create index connector_oauth_lifecycle_jobs_provider_idx
  on app_private.connector_oauth_lifecycle_jobs (provider_id);
create unique index connector_oauth_lifecycle_jobs_intake_key_idx
  on app_private.connector_oauth_lifecycle_jobs (intake_key)
  where intake_key is not null;

alter table app_private.connector_oauth_lifecycle_jobs enable row level security;
alter table app_private.connector_oauth_lifecycle_jobs force row level security;
revoke all on table app_private.connector_oauth_lifecycle_jobs
  from public, anon, authenticated, service_role;

drop policy if exists credential_references_service
  on public.credential_references;
drop policy if exists connector_installations_service
  on public.connector_installations;
drop policy if exists connector_oauth_states_service
  on app_private.connector_oauth_states;
create policy credential_references_service_read
  on public.credential_references for select to service_role using (true);
create policy connector_installations_service_read
  on public.connector_installations for select to service_role using (true);
revoke all on table public.credential_references,
  public.connector_installations, app_private.connector_oauth_states
  from service_role;
grant select on table public.credential_references,
  public.connector_installations to service_role;

-- The original wrapper passed a removed fourth argument to Vault. Keep this
-- helper private to lifecycle definer functions and use Vault's stable ABI.
create or replace function public.store_connector_secret(
  target_brand uuid,
  target_provider_key text,
  plaintext_secret text,
  target_account_label text default '',
  target_scopes text[] default '{}',
  target_expires_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  reference_id uuid;
  stored_secret uuid;
  target_provider uuid;
begin
  if target_brand is null
    or target_provider_key is null
    or target_provider_key !~ '^[a-z][a-z0-9_-]{0,62}$'
    or plaintext_secret is null
    or length(plaintext_secret) not between 8 and 24576
    or target_account_label is null
    or length(target_account_label) > 160
    or target_scopes is null or cardinality(target_scopes) > 32
    or exists (select 1 from unnest(target_scopes) scope(value)
      where scope.value is null or length(scope.value) not between 1 and 512) then
    raise exception using errcode = '22023', message = 'connector_secret_invalid';
  end if;
  select registry.id into target_provider
  from public.connector_registry registry
  where registry.provider_key = target_provider_key and registry.is_active;
  if target_provider is null then
    raise exception using errcode = '22023', message = 'connector_provider_unknown';
  end if;
  stored_secret := vault.create_secret(
    plaintext_secret,
    'connector_' || target_brand::text || '_' || target_provider_key || '_'
      || gen_random_uuid()::text,
    'Tenant connector credential. Resolve only from a lifecycle RPC.'
  );
  insert into public.credential_references (
    brand_id, provider_id, vault_secret_id, account_label, granted_scopes,
    expires_at
  ) values (
    target_brand, target_provider, stored_secret, target_account_label,
    target_scopes, target_expires_at
  ) returning id into reference_id;
  return reference_id;
end $lifecycle$;
revoke all on function public.store_connector_secret(
  uuid, text, text, text, text[], timestamptz
) from service_role;
revoke all on function public.revoke_connector_secret(uuid, uuid)
  from service_role;
revoke all on function public.resolve_connector_secret(uuid, uuid)
  from service_role;
revoke all on function public.register_square_connector(
  uuid, uuid, uuid, text, text, text, timestamptz, uuid
) from service_role;

create function app.connector_job_credential_valid(
  p_provider_id uuid,
  p_operation text,
  p_credential_text text,
  p_expected_fingerprint text
) returns boolean
language plpgsql stable security definer set search_path = '' as $lifecycle$
declare
  v_credential jsonb;
  v_revocation_scope text;
begin
  v_credential := app.try_connector_credential_json(p_credential_text);
  select provider.oauth_revocation_scope into v_revocation_scope
  from public.connector_registry provider
  where provider.id = p_provider_id and provider.oauth_lifecycle_managed;
  if v_credential is null or v_revocation_scope is null
    or pg_column_size(v_credential) > 24576
    or jsonb_typeof(v_credential->'access_token') is distinct from 'string'
    or octet_length(v_credential->>'access_token') not between 8 and 16384 then
    return false;
  end if;
  if p_operation = 'revoke' and v_revocation_scope = 'credential' then
    return true;
  end if;
  return coalesce(
    jsonb_typeof(v_credential->'external_account_id') = 'string'
    and octet_length(v_credential->>'external_account_id') between 1 and 512
    and app.connector_external_account_fingerprint(
      p_provider_id, p_credential_text
    ) = p_expected_fingerprint
    and (p_operation <> 'refresh' or (
      jsonb_typeof(v_credential->'refresh_token') = 'string'
      and octet_length(v_credential->>'refresh_token') between 8 and 16384
    )), false);
end $lifecycle$;
revoke all on function app.connector_job_credential_valid(
  uuid, text, text, text
) from public, anon, authenticated, service_role;

create function app.cancel_connector_refresh_on_invalidation()
returns trigger language plpgsql security definer set search_path = '' as $lifecycle$
begin
  if new.status in (
      'setup_required', 'reauthorization_required', 'disabled', 'revoked'
    ) and (old.status is distinct from new.status
      or old.credential_reference_id is distinct from new.credential_reference_id)
    and old.credential_reference_id is not null then
    update app_private.connector_oauth_lifecycle_jobs job set
      state = case when job.state = 'leased' then 'leased' else 'cancelled' end,
      cancel_requested = true,
      lease_token = case when job.state = 'leased' then job.lease_token else null end,
      lease_expires_at = case when job.state = 'leased'
        then job.lease_expires_at else null end,
      completed_at = case when job.state = 'leased' then null else now() end,
      last_error_code = case when job.state = 'leased'
        then job.last_error_code else 'authorization_invalidated' end,
      updated_at = now()
    where job.installation_id = new.id and job.brand_id = new.brand_id
      and job.credential_reference_id = old.credential_reference_id
      and job.operation = 'refresh'
      and job.state not in ('succeeded', 'cancelled', 'permanent_failure');
  end if;
  return new;
end $lifecycle$;
revoke all on function app.cancel_connector_refresh_on_invalidation()
  from public, anon, authenticated, service_role;
drop trigger if exists connector_installations_cancel_invalid_refresh
  on public.connector_installations;
create trigger connector_installations_cancel_invalid_refresh
  after update of status, credential_reference_id on public.connector_installations
  for each row execute function app.cancel_connector_refresh_on_invalidation();

create function app.queue_connector_oauth_compensation_internal(
  p_brand_id uuid,
  p_installation_id uuid,
  p_provider_id uuid,
  p_actor_user_id uuid,
  p_consume_key uuid,
  p_cleanup_key uuid,
  p_credential jsonb,
  p_account_label text,
  p_granted_scopes text[],
  p_expires_at timestamptz,
  p_reason text,
  p_payload_fingerprint text,
  p_identity_hint jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_account_fingerprint text;
  v_existing app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_intake_fingerprint text;
  v_provider public.connector_registry%rowtype;
  v_reference_id uuid;
  v_secret_id uuid;
  v_state app_private.connector_oauth_states%rowtype;
begin
  if p_brand_id is null or p_installation_id is null or p_provider_id is null
    or p_actor_user_id is null or p_consume_key is null or p_cleanup_key is null
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential) > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or p_granted_scopes is null or cardinality(p_granted_scopes) > 32
    or exists (select 1 from unnest(p_granted_scopes) scope(value)
      where scope.value is null or length(scope.value) not between 1 and 512)
    or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_payload_fingerprint is null
    or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_identity_hint) is distinct from 'object'
    or pg_column_size(p_identity_hint) > 2048 then
    raise exception using errcode = '22023',
      message = 'connector_oauth_compensation_invalid';
  end if;
  v_intake_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'completionFingerprint', p_payload_fingerprint,
      'identityHint', p_identity_hint,
      'reason', p_reason
    )::text, 'sha256'
  ), 'hex');

  select provider.* into v_provider
  from public.connector_registry provider
  where provider.id = p_provider_id and provider.oauth_lifecycle_managed
  for update;
  if not found then
    raise exception using errcode = '22023',
      message = 'connector_oauth_compensation_provider_invalid';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_provider.oauth_grant_namespace
  for update;
  perform 1 from public.connector_installations installation
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id
    and installation.provider_id = p_provider_id
    and installation.environment = 'production'
  for update;
  if not found then
    raise exception using errcode = '22023',
      message = 'connector_oauth_compensation_installation_invalid';
  end if;
  select state.* into v_state
  from app_private.connector_oauth_states state
  where state.installation_id = p_installation_id
    and state.brand_id = p_brand_id
    and state.provider_id = p_provider_id
    and state.requested_by = p_actor_user_id
    and state.consume_key = p_consume_key
  for update;
  if not found then
    raise exception using errcode = '22023',
      message = 'connector_oauth_compensation_state_invalid';
  end if;
  if v_state.completion_key = p_consume_key
    and v_state.completion_fingerprint = p_payload_fingerprint
    and v_state.completion_outcome in ('connected', 'cleanup_queued') then
    return jsonb_build_object(
      'outcome', v_state.completion_outcome,
      'referenceId', v_state.completed_reference_id
    );
  end if;

  select job.* into v_existing
  from app_private.connector_oauth_lifecycle_jobs job
  where job.intake_key = p_cleanup_key for update;
  if found then
    if v_existing.intake_fingerprint <> v_intake_fingerprint then
      raise exception using errcode = '22023',
        message = 'connector_oauth_compensation_conflict';
    end if;
    return jsonb_build_object(
      'outcome', 'cleanup_queued',
      'referenceId', v_existing.credential_reference_id
    );
  end if;

  v_account_fingerprint := app.connector_external_account_fingerprint(
    p_provider_id, p_credential::text
  );
  v_secret_id := vault.create_secret(
    p_credential::text,
    'connector_cleanup_' || p_brand_id::text || '_' || p_cleanup_key::text,
    'Rejected OAuth credential retained until durable provider cleanup.'
  );
  insert into public.credential_references (
    brand_id, provider_id, vault_secret_id, account_label, granted_scopes,
    expires_at, revoked_at, external_account_fingerprint
  ) values (
    p_brand_id, p_provider_id, v_secret_id,
    left(coalesce(nullif(btrim(p_account_label), ''), 'Unverified OAuth account'), 160),
    p_granted_scopes, p_expires_at, now(), v_account_fingerprint
  ) returning id into v_reference_id;
  insert into app_private.connector_oauth_lifecycle_jobs (
    brand_id, installation_id, credential_reference_id, provider_id,
    operation, state, credential_generation, next_attempt_at,
    is_compensation, intake_key, intake_fingerprint, cleanup_reason,
    last_error_code, completed_at, identity_hint
  ) values (
    p_brand_id, p_installation_id, v_reference_id, p_provider_id,
    case when v_account_fingerprint is null
        and v_provider.oauth_revocation_scope = 'grant'
      then 'identify' else 'revoke' end,
    'pending', 1,
    case when v_account_fingerprint is not null
        and v_provider.oauth_revocation_scope = 'grant'
      then now() + interval '31 minutes' else now() end,
    true, p_cleanup_key, v_intake_fingerprint, p_reason,
    null, null, p_identity_hint
  );
  update app_private.connector_oauth_states state set
    completion_key = p_consume_key,
    completed_reference_id = v_reference_id,
    completion_fingerprint = p_payload_fingerprint,
    completion_outcome = 'cleanup_queued',
    processing_lease_token = null,
    processing_lease_expires_at = null,
    exchange_attempt_key = null,
    exchange_started_at = null
  where state.id = v_state.id and state.completion_key is null;
  insert into public.connector_audit_events (
    brand_id, installation_id, actor_user_id, action, outcome,
    correlation_id, source, detail
  ) values (
    p_brand_id, p_installation_id, p_actor_user_id,
    'oauth.compensation_queued',
    'success',
    p_cleanup_key, 'hq', jsonb_build_object(
      'reason', p_reason,
      'identityResolved', v_account_fingerprint is not null,
      'identityResolutionQueued', v_account_fingerprint is null
        and v_provider.oauth_revocation_scope = 'grant',
      'revocationScope', v_provider.oauth_revocation_scope
    )
  );
  return jsonb_build_object(
    'outcome', 'cleanup_queued', 'referenceId', v_reference_id
  );
end $lifecycle$;
revoke all on function app.queue_connector_oauth_compensation_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text, text[], timestamptz, text,
  text, jsonb
) from public, anon, authenticated, service_role;

create function public.queue_connector_oauth_compensation(
  p_brand_id uuid,
  p_installation_id uuid,
  p_provider_key text,
  p_actor_user_id uuid,
  p_consume_key uuid,
  p_cleanup_key uuid,
  p_credential jsonb,
  p_account_label text,
  p_granted_scopes text[],
  p_expires_at timestamptz,
  p_reason text,
  p_identity_hint jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_completion_fingerprint text;
  v_provider_id uuid;
  v_scopes text[];
begin
  if p_provider_key is null or p_provider_key !~ '^[a-z][a-z0-9_-]{0,62}$'
    or p_granted_scopes is null or cardinality(p_granted_scopes) > 32
    or jsonb_typeof(p_identity_hint) is distinct from 'object'
    or pg_column_size(p_identity_hint) > 2048 then
    raise exception using errcode = '22023',
      message = 'connector_oauth_compensation_invalid';
  end if;
  select provider.id into v_provider_id
  from public.connector_registry provider
  where provider.provider_key = p_provider_key and provider.oauth_lifecycle_managed;
  if v_provider_id is null then
    raise exception using errcode = '22023',
      message = 'connector_oauth_compensation_provider_invalid';
  end if;
  select coalesce(array_agg(distinct scope.value order by scope.value), '{}')
  into v_scopes from unnest(p_granted_scopes) scope(value);
  v_completion_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'credential', p_credential,
      'accountLabel', btrim(p_account_label),
      'grantedScopes', to_jsonb(v_scopes),
      'expiresAt', to_jsonb(p_expires_at)
    )::text, 'sha256'
  ), 'hex');
  return app.queue_connector_oauth_compensation_internal(
    p_brand_id, p_installation_id, v_provider_id, p_actor_user_id,
    p_consume_key, p_cleanup_key, p_credential, p_account_label,
    v_scopes, p_expires_at,
    p_reason, v_completion_fingerprint, p_identity_hint
  );
end $lifecycle$;
revoke all on function public.queue_connector_oauth_compensation(
  uuid, uuid, text, uuid, uuid, uuid, jsonb, text, text[], timestamptz, text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.queue_connector_oauth_compensation(
  uuid, uuid, text, uuid, uuid, uuid, jsonb, text, text[], timestamptz, text,
  jsonb
) to service_role;

create function app.disable_unavailable_connector_credentials(
  p_now timestamptz,
  p_limit integer
) returns integer
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_changed integer;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023',
      message = 'connector_disable_unavailable_invalid';
  end if;

  with candidates as (
    select installation.id as installation_id, installation.brand_id,
      installation.status as previous_status, reference.id as reference_id,
      reference.provider_id, reference.credential_generation
    from public.connector_installations installation
    join public.connector_registry provider on provider.id = installation.provider_id
    join public.credential_references reference
      on reference.id = installation.credential_reference_id
     and reference.brand_id = installation.brand_id
    where (not provider.is_active or provider.availability not in (
        'available', 'provider_approval_required'
      ))
      and provider.oauth_lifecycle_managed
      and (
        reference.revoked_at is null or not exists (
          select 1 from app_private.connector_oauth_lifecycle_jobs revoke_job
          where revoke_job.credential_reference_id = reference.id
            and revoke_job.operation = 'revoke'
        )
      )
    order by installation.id
    for update of installation skip locked
    limit p_limit
  ), changed as (
    update public.connector_installations installation set
      status = 'disabled', enabled_capabilities = '{}', updated_at = p_now
    from candidates
    where installation.id = candidates.installation_id
    returning installation.id, installation.brand_id,
      candidates.reference_id, candidates.provider_id,
      candidates.credential_generation, candidates.previous_status
  ), cancelled_refreshes as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = case when job.state = 'leased' then 'leased' else 'cancelled' end,
      cancel_requested = true,
      lease_token = case when job.state = 'leased' then job.lease_token else null end,
      lease_expires_at = case
        when job.state = 'leased' then job.lease_expires_at else null end,
      completed_at = case when job.state = 'leased' then null else p_now end,
      updated_at = p_now
    from changed
    where job.credential_reference_id = changed.reference_id
      and job.operation = 'refresh'
      and job.state not in ('succeeded', 'cancelled')
    returning job.id
  ), revoked as (
    update public.credential_references reference set
      revoked_at = coalesce(reference.revoked_at, p_now), updated_at = p_now
    from changed
    where reference.id = changed.reference_id
      and reference.brand_id = changed.brand_id
    returning reference.id, reference.brand_id, reference.provider_id,
      reference.credential_generation
  ), queued as (
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) select changed.brand_id, changed.id, revoked.id, revoked.provider_id,
      'revoke', revoked.credential_generation, p_now
    from revoked join changed on changed.reference_id = revoked.id
    on conflict (credential_reference_id, operation) do update set
      state = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.state else 'pending' end,
      credential_generation = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.credential_generation
        else excluded.credential_generation end,
      attempt_count = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.attempt_count else 0 end,
      next_attempt_at = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.next_attempt_at else p_now end,
      lease_token = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.lease_token else null end,
      lease_expires_at = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.lease_expires_at else null end,
      last_error_code = case when connector_oauth_lifecycle_jobs.state in (
        'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.last_error_code else null end,
      completed_at = case when connector_oauth_lifecycle_jobs.state in (
        'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.completed_at else null end,
      updated_at = p_now
    returning id
  ), audited as (
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    ) select changed.brand_id, changed.id, 'credential.status_changed', 'success',
      gen_random_uuid(), 'system', jsonb_build_object(
        'previousStatus', changed.previous_status,
        'status', 'disabled', 'reason', 'provider_unavailable'
      )
    from changed
    returning 1
  )
  select count(*)::integer into v_changed from audited;
  return v_changed;
end $lifecycle$;
revoke all on function app.disable_unavailable_connector_credentials(
  timestamptz, integer
) from public, anon, authenticated, service_role;

insert into app_private.connector_oauth_lifecycle_jobs (
  brand_id, installation_id, credential_reference_id, provider_id,
  operation, credential_generation, next_attempt_at
)
select installation.brand_id, installation.id, reference.id, provider.id,
  'refresh', reference.credential_generation,
  case when reference.expires_at is null then now() + interval '25 days'
    else greatest(now() + interval '1 minute', reference.expires_at - interval '10 minutes') end
from public.connector_installations installation
join public.credential_references reference
  on reference.id = installation.credential_reference_id
 and reference.brand_id = installation.brand_id
join public.connector_registry provider on provider.id = installation.provider_id
where installation.status in ('connected_healthy', 'connected_degraded')
  and reference.revoked_at is null
  and provider.is_active
  and provider.availability in ('available', 'provider_approval_required')
  and provider.oauth_lifecycle_managed
  and provider.oauth_refresh_managed
  and reference.expires_at is not null
on conflict (credential_reference_id, operation) do nothing;

do $lifecycle$
declare
  v_changed integer;
begin
  loop
    v_changed := app.disable_unavailable_connector_credentials(now(), 500);
    exit when v_changed < 500;
  end loop;
end $lifecycle$;

drop view public.location_square_status;
drop function app.location_square_status_rows();

create function app.location_square_status_rows()
returns table (
  location_id uuid,
  brand_id uuid,
  merchant_id text,
  expires_at timestamptz,
  oauth_scope_contract_version integer
)
language sql stable security definer
set search_path = ''
as $lifecycle$
  select connection.location_id, connection.brand_id,
         connection.merchant_id, connection.expires_at,
         connection.oauth_scope_contract_version
    from public.square_connections connection
   where app.is_brand_staff(connection.brand_id)
$lifecycle$;
revoke execute on function app.location_square_status_rows() from public, anon;
grant execute on function app.location_square_status_rows()
  to authenticated, service_role;

create view public.location_square_status
with (security_barrier = true, security_invoker = true) as
  select * from app.location_square_status_rows();
grant select on public.location_square_status to authenticated;
revoke all on public.location_square_status from anon;
revoke insert, update, delete on public.location_square_status from authenticated;

create or replace function public.begin_connector_oauth_state(
  p_brand_id uuid,
  p_provider_key text,
  p_actor_user_id uuid,
  p_state_hash text,
  p_cookie_binding_hash text,
  p_requested_scopes text[],
  p_redirect_uri text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_contract_version text;
  v_grant_namespace text;
  v_provider_id uuid;
  v_installation_id uuid;
  v_previous_reference uuid;
  v_revocation_scope text;
begin
  if not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_user_id
      and (member.role = 'platform_admin'
        or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
  ) then
    raise exception using errcode = '42501', message = 'connector_oauth_forbidden';
  end if;
  if p_brand_id is null or p_actor_user_id is null
    or p_provider_key is null or p_provider_key !~ '^[a-z][a-z0-9_-]{0,62}$'
    or p_expires_at is null
    or p_expires_at <= now() or p_expires_at > now() + interval '30 minutes'
    or p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_cookie_binding_hash is null
    or p_cookie_binding_hash !~ '^[0-9a-f]{64}$'
    or p_redirect_uri is null
    or p_redirect_uri !~ '^(https://[^[:space:]]+|http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?/[^[:space:]]*)$'
    or p_requested_scopes is null
    or cardinality(p_requested_scopes) not between 0 and 32
    or exists (
      select 1 from unnest(p_requested_scopes) requested(scope)
      where requested.scope is null or length(requested.scope) not between 1 and 512
    ) then
    raise exception using errcode = '22023', message = 'connector_oauth_state_invalid';
  end if;

  select provider.id, provider.adapter_contract_version,
    provider.oauth_revocation_scope, provider.oauth_grant_namespace
  into v_provider_id, v_contract_version, v_revocation_scope,
    v_grant_namespace
  from public.connector_registry provider
  where provider.provider_key = p_provider_key
    and provider.oauth_lifecycle_managed
    and provider.is_active
    and provider.availability in ('available', 'provider_approval_required')
  for update;
  if v_provider_id is null then
    raise exception using errcode = '22023', message = 'connector_provider_unavailable';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_grant_namespace for update;
  perform 1 from public.connector_capabilities capability
  where capability.provider_id = v_provider_id for share;
  perform 1 from public.connector_certifications certification
  join public.connector_capabilities capability
    on capability.id = certification.capability_id
  where capability.provider_id = v_provider_id for share of certification;
  if not exists (
    select 1 from public.connector_capabilities capability
    where capability.provider_id = v_provider_id
      and capability.is_active
      and (cardinality(capability.oauth_scopes) = 0
        or capability.oauth_scopes <@ p_requested_scopes)
      and exists (
        select 1 from public.connector_certifications certification
        where certification.capability_id = capability.id
          and certification.environment = 'sandbox'
          and certification.status = 'passed'
          and certification.contract_version = v_contract_version
          and certification.certified_at is not null
          and (certification.valid_until is null or certification.valid_until > now())
      )
  ) then
    raise exception using errcode = '22023', message = 'connector_oauth_capability_unavailable';
  end if;

  insert into public.connector_installations (
    brand_id, provider_id, environment, status, enabled_capabilities, connected_by
  ) values (
    p_brand_id, v_provider_id, 'production', 'connecting', '{}', p_actor_user_id
  ) on conflict (brand_id, provider_id, environment) do update set
    status = case
      when public.connector_installations.credential_reference_id is not null
        then public.connector_installations.status
      else 'connecting'
    end,
    updated_at = now()
  returning id into v_installation_id;

  select installation.credential_reference_id into v_previous_reference
  from public.connector_installations installation
  where installation.id = v_installation_id
    and installation.brand_id = p_brand_id
  for update;
  if v_previous_reference is not null then
    if not exists (
      select 1 from public.credential_references reference
      where reference.id = v_previous_reference
        and reference.brand_id = p_brand_id
        and reference.external_account_fingerprint is not null
    ) then
      raise exception using errcode = '55000',
        message = 'connector_oauth_existing_grant_unidentified';
    end if;
    perform 1 from app_private.connector_oauth_lifecycle_jobs job
    where job.credential_reference_id = v_previous_reference
    order by job.operation for update;
    if exists (
      select 1 from app_private.connector_oauth_lifecycle_jobs job
      where job.credential_reference_id = v_previous_reference
        and job.operation = 'revoke' and job.state = 'leased'
    ) then
      raise exception using errcode = '55000',
        message = 'connector_oauth_revocation_in_progress';
    end if;
    if exists (
      select 1 from app_private.connector_oauth_lifecycle_jobs job
      where job.credential_reference_id = v_previous_reference
        and job.operation = 'refresh' and job.state = 'leased'
    ) then
      raise exception using errcode = '55000',
        message = 'connector_oauth_refresh_in_progress';
    end if;
    if v_revocation_scope = 'grant' then
      perform public.disconnect_connector_oauth_connection(
        p_brand_id, p_provider_key, p_actor_user_id
      );
      return jsonb_build_object(
        'installationId', v_installation_id,
        'status', 'revocation_pending'
      );
    end if;
  end if;

  update app_private.connector_oauth_states state
  set consumed_at = coalesce(state.consumed_at, now()),
      superseded_at = coalesce(state.superseded_at, now())
  where state.brand_id = p_brand_id
    and state.provider_id = v_provider_id
    and state.installation_id = v_installation_id
    and state.superseded_at is null;

  insert into app_private.connector_oauth_states (
    brand_id, provider_id, installation_id, requested_by, state_hash,
    pkce_verifier_reference, requested_scopes, redirect_uri, expires_at,
    provider_contract_version
  ) values (
    p_brand_id, v_provider_id, v_installation_id, p_actor_user_id, p_state_hash,
    p_cookie_binding_hash, p_requested_scopes, p_redirect_uri, p_expires_at,
    v_contract_version
  );

  delete from app_private.connector_oauth_states state
  where state.id in (
    select expired.id from app_private.connector_oauth_states expired
    where expired.expires_at < now() - interval '1 day'
    order by expired.expires_at, expired.id
    limit 500
  );
  return jsonb_build_object(
    'installationId', v_installation_id,
    'status', 'authorization_ready'
  );
end $lifecycle$;

revoke all on function public.begin_connector_oauth_state(
  uuid, text, uuid, text, text, text[], text, timestamptz
) from public, anon, authenticated;
grant execute on function public.begin_connector_oauth_state(
  uuid, text, uuid, text, text, text[], text, timestamptz
) to service_role;

drop function if exists public.consume_connector_oauth_state(text, uuid, text);

create function public.consume_connector_oauth_state(
  p_provider_key text,
  p_actor_user_id uuid,
  p_state_hash text,
  p_cookie_binding_hash text,
  p_consume_key uuid
) returns table (
  state_id uuid,
  brand_id uuid,
  installation_id uuid,
  cookie_binding_hash text,
  requested_scopes text[],
  redirect_uri text,
  consume_key uuid,
  consume_replayed boolean,
  completion_outcome text,
  completed_reference_id uuid,
  processing_lease_token uuid,
  processing_lease_expires_at timestamptz,
  processing_generation bigint,
  processing_acquired boolean,
  exchange_started boolean
)
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_state app_private.connector_oauth_states%rowtype;
begin
  if p_provider_key is null
    or p_provider_key !~ '^[a-z][a-z0-9_-]{0,62}$'
    or p_actor_user_id is null
    or p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_cookie_binding_hash is null
    or p_cookie_binding_hash !~ '^[0-9a-f]{64}$'
    or p_consume_key is null then
    raise exception using errcode = '22023', message = 'connector_oauth_state_invalid';
  end if;

  select state.* into v_state
  from app_private.connector_oauth_states state
  join public.connector_registry provider on provider.id = state.provider_id
  where provider.provider_key = p_provider_key
    and state.requested_by = p_actor_user_id
    and state.state_hash = p_state_hash
  for update of state;
  if not found or v_state.superseded_at is not null
    or v_state.pkce_verifier_reference <> p_cookie_binding_hash then
    return;
  end if;
  if v_state.consumed_at is not null then
    if v_state.consume_key = p_consume_key then
      if v_state.completion_outcome is null
        and v_state.exchange_started_at is null
        and (v_state.processing_lease_expires_at is null
          or v_state.processing_lease_expires_at <= now()) then
        update app_private.connector_oauth_states state set
          processing_lease_token = gen_random_uuid(),
          processing_lease_expires_at = now() + interval '2 minutes',
          processing_generation = state.processing_generation + 1
        where state.id = v_state.id
        returning state.* into v_state;
      end if;
      return query select v_state.id, v_state.brand_id, v_state.installation_id,
        v_state.pkce_verifier_reference, v_state.requested_scopes,
        v_state.redirect_uri, v_state.consume_key, true,
        v_state.completion_outcome, v_state.completed_reference_id,
        v_state.processing_lease_token, v_state.processing_lease_expires_at,
        v_state.processing_generation,
        v_state.completion_outcome is null
          and v_state.exchange_started_at is null
          and v_state.processing_lease_expires_at > now(),
        v_state.exchange_started_at is not null;
    end if;
    return;
  end if;
  if v_state.expires_at <= now() or not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_user_id
      and (member.role = 'platform_admin'
        or (member.brand_id = v_state.brand_id and member.role = 'brand_owner'))
  ) then
    return;
  end if;

  update app_private.connector_oauth_states state
  set consumed_at = now(), consume_key = p_consume_key,
      processing_lease_token = gen_random_uuid(),
      processing_lease_expires_at = now() + interval '2 minutes',
      processing_generation = state.processing_generation + 1
  where state.id = v_state.id
  returning state.* into v_state;
  return query select v_state.id, v_state.brand_id, v_state.installation_id,
    v_state.pkce_verifier_reference, v_state.requested_scopes,
    v_state.redirect_uri, v_state.consume_key, false, null::text, null::uuid,
    v_state.processing_lease_token, v_state.processing_lease_expires_at,
    v_state.processing_generation, true, false;
end $lifecycle$;

revoke all on function public.consume_connector_oauth_state(
  text, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.consume_connector_oauth_state(
  text, uuid, text, text, uuid
) to service_role;

create function public.start_connector_oauth_code_exchange(
  p_state_id uuid,
  p_consume_key uuid,
  p_processing_lease_token uuid,
  p_exchange_attempt_key uuid,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_state app_private.connector_oauth_states%rowtype;
begin
  if p_state_id is null or p_consume_key is null
    or p_processing_lease_token is null or p_exchange_attempt_key is null
    or p_now is null then
    raise exception using errcode = '22023', message = 'connector_oauth_exchange_invalid';
  end if;
  select state.* into v_state
  from app_private.connector_oauth_states state
  where state.id = p_state_id for update;
  if not found or v_state.consume_key <> p_consume_key
    or v_state.completion_outcome is not null
    or v_state.superseded_at is not null
    or v_state.processing_lease_token <> p_processing_lease_token then
    return false;
  end if;
  if v_state.exchange_started_at is not null then
    return v_state.exchange_attempt_key = p_exchange_attempt_key;
  end if;
  if v_state.processing_lease_expires_at <= p_now then return false; end if;
  update app_private.connector_oauth_states state set
    exchange_attempt_key = p_exchange_attempt_key,
    exchange_started_at = p_now,
    processing_lease_expires_at = greatest(
      state.processing_lease_expires_at, p_now + interval '2 minutes'
    )
  where state.id = v_state.id
    and state.processing_lease_token = p_processing_lease_token
    and state.exchange_started_at is null;
  return found;
end $lifecycle$;

revoke all on function public.start_connector_oauth_code_exchange(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.start_connector_oauth_code_exchange(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

create function public.cancel_connector_oauth_code_exchange(
  p_state_id uuid,
  p_consume_key uuid,
  p_processing_lease_token uuid,
  p_exchange_attempt_key uuid,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_state app_private.connector_oauth_states%rowtype;
begin
  if p_state_id is null or p_consume_key is null
    or p_processing_lease_token is null or p_exchange_attempt_key is null
    or p_now is null then
    raise exception using errcode = '22023', message = 'connector_oauth_exchange_invalid';
  end if;
  select state.* into v_state
  from app_private.connector_oauth_states state
  where state.id = p_state_id for update;
  if not found or v_state.consume_key <> p_consume_key
    or v_state.completion_outcome is not null
    or v_state.processing_lease_token <> p_processing_lease_token
    or v_state.processing_lease_expires_at <= p_now then
    return false;
  end if;
  if v_state.exchange_started_at is null then return true; end if;
  if v_state.exchange_attempt_key <> p_exchange_attempt_key then return false; end if;
  update app_private.connector_oauth_states state set
    exchange_attempt_key = null,
    exchange_started_at = null
  where state.id = v_state.id
    and state.processing_lease_token = p_processing_lease_token
    and state.exchange_attempt_key = p_exchange_attempt_key;
  return found;
end $lifecycle$;

revoke all on function public.cancel_connector_oauth_code_exchange(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.cancel_connector_oauth_code_exchange(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

drop function if exists public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, jsonb, text, text[], timestamptz
);

create function public.complete_connector_oauth_connection(
  p_brand_id uuid,
  p_installation_id uuid,
  p_provider_key text,
  p_actor_user_id uuid,
  p_completion_key uuid,
  p_credential jsonb,
  p_account_label text,
  p_granted_scopes text[],
  p_expires_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_contract_version text;
  v_completion_fingerprint text;
  v_compensation jsonb;
  v_enabled_capabilities text[];
  v_external_account_fingerprint text;
  v_granted_scopes text[];
  v_grant_namespace text;
  v_previous_reference uuid;
  v_previous_reference_row public.credential_references%rowtype;
  v_provider_available boolean;
  v_provider_id uuid;
  v_refresh_managed boolean;
  v_reference_id uuid;
  v_rejection_reason text;
  v_revocation_scope text;
  v_state app_private.connector_oauth_states%rowtype;
begin
  if p_brand_id is null or p_installation_id is null
    or p_provider_key is null or p_provider_key !~ '^[a-z][a-z0-9_-]{0,62}$'
    or p_actor_user_id is null or p_completion_key is null
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential) > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or p_account_label is null
    or length(btrim(p_account_label)) not between 1 and 160
    or p_granted_scopes is null
    or cardinality(p_granted_scopes) not between 0 and 32
    or exists (
      select 1 from unnest(p_granted_scopes) granted(scope)
      where granted.scope is null or length(granted.scope) not between 1 and 512
    ) then
    raise exception using errcode = '22023', message = 'connector_oauth_payload_invalid';
  end if;

  select coalesce(array_agg(distinct granted.scope order by granted.scope), '{}')
  into v_granted_scopes from unnest(p_granted_scopes) granted(scope);
  v_completion_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'credential', p_credential,
      'accountLabel', btrim(p_account_label),
      'grantedScopes', to_jsonb(v_granted_scopes),
      'expiresAt', to_jsonb(p_expires_at)
    )::text, 'sha256'
  ), 'hex');

  select provider.id, provider.adapter_contract_version,
    provider.is_active
      and provider.availability in ('available', 'provider_approval_required'),
    provider.oauth_refresh_managed, provider.oauth_revocation_scope,
    provider.oauth_grant_namespace
  into v_provider_id, v_contract_version, v_provider_available,
    v_refresh_managed, v_revocation_scope, v_grant_namespace
  from public.connector_registry provider
  where provider.provider_key = p_provider_key
    and provider.oauth_lifecycle_managed
  for update;
  if v_provider_id is null then
    raise exception using errcode = '22023', message = 'connector_provider_unavailable';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_grant_namespace for update;
  v_external_account_fingerprint := app.connector_external_account_fingerprint(
    v_provider_id, p_credential::text
  );

  perform 1 from public.connector_capabilities capability
  where capability.provider_id = v_provider_id for share;
  perform 1 from public.connector_certifications certification
  join public.connector_capabilities capability
    on capability.id = certification.capability_id
  where capability.provider_id = v_provider_id for share of certification;

  select installation.credential_reference_id into v_previous_reference
  from public.connector_installations installation
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id
    and installation.provider_id = v_provider_id
    and installation.environment = 'production'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'connector_installation_unknown';
  end if;
  if v_previous_reference is not null then
    select reference.* into v_previous_reference_row
    from public.credential_references reference
    where reference.id = v_previous_reference
      and reference.brand_id = p_brand_id
    for update;
    if not found then
      raise exception using errcode = '55000',
        message = 'connector_oauth_existing_credential_invalid';
    end if;
  end if;

  select state.* into v_state
  from app_private.connector_oauth_states state
  where state.installation_id = p_installation_id
    and state.brand_id = p_brand_id
    and state.provider_id = v_provider_id
    and state.requested_by = p_actor_user_id
    and state.consume_key = p_completion_key
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'connector_oauth_state_incomplete';
  end if;

  if v_state.completion_key = p_completion_key
    and v_state.completed_reference_id is not null then
    if v_state.completion_fingerprint = v_completion_fingerprint then
      return case when v_state.completion_outcome = 'connected'
        then v_state.completed_reference_id else null end;
    end if;
    if v_previous_reference_row.external_account_fingerprint
      = v_external_account_fingerprint then
      raise exception using errcode = '22023',
        message = 'connector_oauth_completion_conflict_shared_grant';
    end if;
    raise exception using errcode = '22023',
      message = 'connector_oauth_completion_conflict_safe_revoke';
  end if;
  if v_state.completion_key is not null then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_conflict';
  end if;
  if v_state.exchange_started_at is null then
    v_rejection_reason := 'exchange_not_started';
  end if;
  if v_state.superseded_at is not null then
    v_rejection_reason := 'authorization_superseded';
  end if;
  if v_rejection_reason is null and v_previous_reference is not null then
    perform 1 from app_private.connector_oauth_lifecycle_jobs job
    where job.credential_reference_id = v_previous_reference
    order by job.operation for update;
    if exists (
      select 1 from app_private.connector_oauth_lifecycle_jobs job
      where job.credential_reference_id = v_previous_reference
        and job.operation in ('refresh', 'revoke') and job.state = 'leased'
    ) then
      v_rejection_reason := 'credential_operation_in_progress';
    end if;
    if v_previous_reference_row.external_account_fingerprint is null then
      v_rejection_reason := 'existing_grant_unidentified';
    end if;
    if v_revocation_scope = 'grant' then
      v_rejection_reason := 'prior_grant_requires_revocation';
    end if;
  end if;

  if v_rejection_reason is null and v_revocation_scope = 'grant'
    and v_external_account_fingerprint is not null
    and exists (
      select 1
      from app_private.connector_oauth_lifecycle_jobs revoke_job
      join public.credential_references retiring_reference
        on retiring_reference.id = revoke_job.credential_reference_id
       and retiring_reference.brand_id = revoke_job.brand_id
      join public.connector_registry retiring_provider
        on retiring_provider.id = revoke_job.provider_id
      where revoke_job.operation = 'revoke'
        and (revoke_job.state in ('pending', 'leased', 'permanent_failure')
          or (revoke_job.state = 'succeeded'
            and revoke_job.last_error_code is distinct from 'shared_grant_retained'
            and revoke_job.completed_at >= v_state.consumed_at))
        and retiring_provider.oauth_lifecycle_managed
        and retiring_provider.oauth_revocation_scope = 'grant'
        and retiring_provider.oauth_grant_namespace = v_grant_namespace
        and retiring_reference.external_account_fingerprint
          = v_external_account_fingerprint
    ) then
    v_rejection_reason := 'grant_revocation_in_progress';
  end if;

  if v_rejection_reason is null and not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_user_id
      and (member.role = 'platform_admin'
        or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
  ) then
    v_rejection_reason := 'actor_forbidden';
  end if;
  if v_rejection_reason is null and not v_provider_available then
    v_rejection_reason := 'provider_unavailable';
  end if;
  if v_rejection_reason is null and (v_state.consumed_at is null
    or v_state.expires_at <= now()
    or (p_expires_at is not null and p_expires_at <= now())) then
    v_rejection_reason := 'state_or_credential_expired';
  end if;
  if v_rejection_reason is null
    and v_state.provider_contract_version is distinct from v_contract_version then
    v_rejection_reason := 'provider_contract_changed';
  end if;
  if v_rejection_reason is null
    and not v_state.requested_scopes <@ v_granted_scopes then
    v_rejection_reason := 'scope_grant_incomplete';
  end if;
  if v_rejection_reason is null and v_refresh_managed and (
    jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
    or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
  ) then
    v_rejection_reason := 'refresh_contract_invalid';
  end if;

  select coalesce(array_agg(
    capability.capability_key order by capability.capability_key
  ), '{}') into v_enabled_capabilities
  from public.connector_capabilities capability
  where capability.provider_id = v_provider_id
    and capability.is_active
    and (cardinality(capability.oauth_scopes) = 0
      or (capability.oauth_scopes <@ v_state.requested_scopes
        and capability.oauth_scopes <@ v_granted_scopes))
    and exists (
      select 1 from public.connector_certifications certification
      where certification.capability_id = capability.id
        and certification.environment = 'sandbox'
        and certification.status = 'passed'
        and certification.contract_version = v_contract_version
        and certification.certified_at is not null
        and (certification.valid_until is null or certification.valid_until > now())
    );
  if v_rejection_reason is null and cardinality(v_enabled_capabilities) = 0 then
    v_rejection_reason := 'capability_unavailable';
  end if;
  if v_rejection_reason is null and v_revocation_scope = 'grant'
    and exists (
      select 1
      from public.connector_installations other_installation
      join public.credential_references other_reference
        on other_reference.id = other_installation.credential_reference_id
       and other_reference.brand_id = other_installation.brand_id
      join public.connector_registry other_provider
        on other_provider.id = other_reference.provider_id
      where other_installation.id <> p_installation_id
        and other_reference.revoked_at is null
        and other_reference.external_account_fingerprint = v_external_account_fingerprint
        and other_provider.oauth_grant_namespace = v_grant_namespace
    ) then
    v_rejection_reason := 'shared_grant_already_connected';
  end if;
  if v_rejection_reason is null and v_external_account_fingerprint is null then
    v_rejection_reason := 'external_account_unresolved';
  end if;
  if v_rejection_reason is not null then
    v_compensation := app.queue_connector_oauth_compensation_internal(
      p_brand_id, p_installation_id, v_provider_id, p_actor_user_id,
      p_completion_key, p_completion_key, p_credential, p_account_label,
      v_granted_scopes, p_expires_at, v_rejection_reason,
      v_completion_fingerprint, '{}'::jsonb
    );
    return null;
  end if;

  v_reference_id := public.store_connector_secret(
    p_brand_id, p_provider_key, p_credential::text, p_account_label,
    v_granted_scopes, p_expires_at
  );
  update public.credential_references reference set
    external_account_fingerprint = v_external_account_fingerprint,
    updated_at = now()
  where reference.id = v_reference_id and reference.brand_id = p_brand_id;
  update public.connector_installations installation set
    credential_reference_id = v_reference_id,
    status = case when v_refresh_managed then 'connected_healthy'
      when p_expires_at is not null and p_expires_at <= now() + interval '7 days'
      then 'connected_degraded' else 'connected_healthy' end,
    enabled_capabilities = v_enabled_capabilities,
    external_account_label = p_account_label,
    settings = installation.settings || jsonb_build_object(
      'oauthRequestedScopes', to_jsonb(v_state.requested_scopes)
    ),
    connected_by = p_actor_user_id,
    connected_at = now(),
    disabled_at = null,
    updated_at = now()
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id;

  update app_private.connector_oauth_states state set
    completion_key = p_completion_key,
    completed_reference_id = v_reference_id,
    completion_fingerprint = v_completion_fingerprint,
    completion_outcome = 'connected',
    processing_lease_token = null,
    processing_lease_expires_at = null,
    exchange_attempt_key = null,
    exchange_started_at = null
  where state.id = v_state.id;

  if v_refresh_managed then
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) values (
      p_brand_id, p_installation_id, v_reference_id, v_provider_id,
      'refresh', 1,
      greatest(now() + interval '1 minute', p_expires_at - interval '10 minutes')
    );
  end if;

  if v_previous_reference is not null
    and v_previous_reference <> v_reference_id then
    update app_private.connector_oauth_lifecycle_jobs job set
      state = case when job.state = 'leased' then 'leased' else 'cancelled' end,
      cancel_requested = true,
      lease_token = case when job.state = 'leased' then job.lease_token else null end,
      lease_expires_at = case
        when job.state = 'leased' then job.lease_expires_at else null end,
      completed_at = case when job.state = 'leased' then null else now() end,
      updated_at = now()
    where job.credential_reference_id = v_previous_reference
      and job.operation = 'refresh'
      and job.state not in ('succeeded', 'cancelled');
    update public.credential_references reference set
      revoked_at = coalesce(reference.revoked_at, now()), updated_at = now()
    where reference.id = v_previous_reference
      and reference.brand_id = p_brand_id;
    insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, credential_generation, next_attempt_at
      ) select
        reference.brand_id, p_installation_id, reference.id, reference.provider_id,
        'revoke', reference.credential_generation, now()
      from public.credential_references reference
      where reference.id = v_previous_reference
        and reference.brand_id = p_brand_id
      on conflict (credential_reference_id, operation) do update set
        state = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then 'succeeded' else 'pending' end,
        attempt_count = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.attempt_count else 0 end,
        next_attempt_at = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.next_attempt_at else now() end,
        lease_token = null, lease_expires_at = null,
        last_finished_lease_token = case
          when connector_oauth_lifecycle_jobs.state = 'succeeded'
            then connector_oauth_lifecycle_jobs.last_finished_lease_token else null end,
        last_finished_outcome = case
          when connector_oauth_lifecycle_jobs.state = 'succeeded'
            then connector_oauth_lifecycle_jobs.last_finished_outcome else null end,
        last_finished_fingerprint = case
          when connector_oauth_lifecycle_jobs.state = 'succeeded'
            then connector_oauth_lifecycle_jobs.last_finished_fingerprint else null end,
        last_error_code = null,
        completed_at = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.completed_at else null end,
        updated_at = now();
  end if;

  insert into public.connector_audit_events (
    brand_id, installation_id, actor_user_id, action, outcome,
    correlation_id, source, detail
  ) values (
    p_brand_id, p_installation_id, p_actor_user_id, 'oauth.connected',
    'success', p_completion_key, 'hq', jsonb_build_object(
      'provider', p_provider_key,
      'requestedScopeCount', cardinality(v_state.requested_scopes),
      'grantedScopeCount', cardinality(v_granted_scopes)
    )
  );
  return v_reference_id;
end $lifecycle$;

revoke all on function public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, uuid, jsonb, text, text[], timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, uuid, jsonb, text, text[], timestamptz
) to service_role;

create or replace function public.reconcile_connector_credential_status(
  p_now timestamptz default now(),
  p_limit integer default 100
) returns integer
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  changed_count integer;
  disabled_count integer;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'connector_reconcile_time_invalid';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'connector_reconcile_limit_invalid';
  end if;

  disabled_count := app.disable_unavailable_connector_credentials(p_now, p_limit);
  if disabled_count >= p_limit then
    return disabled_count;
  end if;

  with candidates as (
    select installation.id, installation.status as previous_status,
      decision.next_status
    from public.connector_installations installation
    join public.connector_registry provider on provider.id = installation.provider_id
    left join public.credential_references reference
      on reference.id = installation.credential_reference_id
     and reference.brand_id = installation.brand_id
    cross join lateral (
      select case
        when not provider.is_active
          or provider.availability not in ('available', 'provider_approval_required')
          then 'disabled'
        when installation.status = 'connecting' and not exists (
          select 1 from app_private.connector_oauth_states state
          where state.installation_id = installation.id
            and state.brand_id = installation.brand_id
            and state.superseded_at is null
            and state.expires_at > p_now
        ) then case when reference.id is null
          then 'setup_required' else 'reauthorization_required' end
        when installation.status <> 'connecting'
          and (reference.id is null or reference.revoked_at is not null)
          then 'reauthorization_required'
        when installation.status <> 'connecting'
          and provider.oauth_refresh_managed and reference.expires_at is null
          then 'reauthorization_required'
        when installation.status <> 'connecting'
          and reference.expires_at is not null
          and reference.expires_at <= p_now
          and exists (
            select 1 from app_private.connector_oauth_lifecycle_jobs refresh_job
            where refresh_job.credential_reference_id = reference.id
              and refresh_job.operation = 'refresh'
              and refresh_job.state in ('pending', 'leased')
              and not refresh_job.cancel_requested
          ) then 'connected_degraded'
        when installation.status <> 'connecting'
          and reference.expires_at is not null
          and reference.expires_at <= p_now
          then 'reauthorization_required'
        when installation.status <> 'connecting' and (
          cardinality(installation.enabled_capabilities) = 0
          or exists (
            select 1
            from unnest(installation.enabled_capabilities) enabled(capability_key)
            where not exists (
              select 1
              from public.connector_capabilities capability
              join public.connector_certifications certification
                on certification.capability_id = capability.id
              where capability.provider_id = installation.provider_id
                and capability.capability_key = enabled.capability_key
                and capability.is_active
                and (cardinality(capability.oauth_scopes) = 0
                  or capability.oauth_scopes <@ reference.granted_scopes)
                and certification.environment = 'sandbox'
                and certification.status = 'passed'
                and certification.contract_version = provider.adapter_contract_version
                and certification.certified_at is not null
                and (certification.valid_until is null or certification.valid_until > p_now)
            )
          )
        ) then 'reauthorization_required'
        when installation.status <> 'connecting'
          and provider.oauth_lifecycle_managed and (
          jsonb_typeof(installation.settings->'oauthRequestedScopes') is distinct from 'array'
          or not (
            (installation.settings->'oauthRequestedScopes')
              <@ to_jsonb(reference.granted_scopes)
          )
        ) then 'reauthorization_required'
        when installation.status = 'connected_healthy'
          and reference.expires_at <= p_now + interval '7 days'
          and not exists (
            select 1 from app_private.connector_oauth_lifecycle_jobs refresh_job
            where refresh_job.credential_reference_id = reference.id
              and refresh_job.operation = 'refresh'
              and refresh_job.state in ('pending', 'leased')
              and not refresh_job.cancel_requested
          )
          then 'connected_degraded'
        else installation.status
      end as next_status
    ) decision
    where installation.status in ('connecting', 'connected_healthy', 'connected_degraded')
      and installation.status <> decision.next_status
    order by reference.expires_at nulls last, installation.id
    for update of installation skip locked
    limit p_limit - disabled_count
  ), changed as (
    update public.connector_installations installation
    set status = candidates.next_status,
        enabled_capabilities = case
          when candidates.next_status in (
            'setup_required', 'reauthorization_required', 'disabled'
          ) then '{}'
          else installation.enabled_capabilities end,
        updated_at = p_now
    from candidates
    where installation.id = candidates.id
      and installation.status <> candidates.next_status
    returning installation.id, installation.brand_id,
      candidates.previous_status, installation.status as next_status
  ), audited as (
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    )
    select changed.brand_id, changed.id, 'credential.status_changed', 'success',
      gen_random_uuid(), 'cron', jsonb_build_object(
        'previousStatus', changed.previous_status,
        'status', changed.next_status
      )
    from changed
    returning 1
  )
  select count(*)::integer into changed_count from audited;
  return disabled_count + changed_count;
end $lifecycle$;

create function app.invalidate_connector_provider_availability()
returns trigger language plpgsql security definer set search_path = '' as $lifecycle$
begin
  if not new.oauth_lifecycle_managed then
    return new;
  end if;
  if old.adapter_contract_version is distinct from new.adapter_contract_version
    and new.is_active
    and new.availability in ('available', 'provider_approval_required') then
    with changed as (
      update public.connector_installations installation set
        status = 'reauthorization_required', enabled_capabilities = '{}',
        updated_at = now()
      where installation.provider_id = new.id
        and installation.status in ('connected_healthy', 'connected_degraded')
      returning installation.id, installation.brand_id
    )
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    ) select changed.brand_id, changed.id, 'credential.status_changed', 'success',
      gen_random_uuid(), 'system', jsonb_build_object(
        'status', 'reauthorization_required',
        'reason', 'adapter_contract_changed',
        'contractVersion', new.adapter_contract_version
      ) from changed;
    return new;
  end if;
  if new.is_active
    and new.availability in ('available', 'provider_approval_required') then
    return new;
  end if;
  with changed as (
    update public.connector_installations installation set
      status = 'disabled', enabled_capabilities = '{}', updated_at = now()
    where installation.provider_id = new.id
      and installation.status in (
        'connecting', 'connected_healthy', 'connected_degraded',
        'reauthorization_required'
      )
    returning installation.id, installation.brand_id,
      installation.credential_reference_id
  ), cancelled_refreshes as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = case when job.state = 'leased' then 'leased' else 'cancelled' end,
      cancel_requested = true,
      lease_token = case when job.state = 'leased' then job.lease_token else null end,
      lease_expires_at = case
        when job.state = 'leased' then job.lease_expires_at else null end,
      completed_at = case when job.state = 'leased' then null else now() end,
      updated_at = now()
    from changed
    where job.credential_reference_id = changed.credential_reference_id
      and job.operation = 'refresh'
      and job.state not in ('succeeded', 'cancelled')
    returning job.id
  ), revoked as (
    update public.credential_references reference set
      revoked_at = coalesce(reference.revoked_at, now()), updated_at = now()
    from changed
    where reference.id = changed.credential_reference_id
      and reference.brand_id = changed.brand_id
    returning reference.id, reference.brand_id, reference.provider_id,
      reference.credential_generation
  ), queued_revocations as (
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) select revoked.brand_id, changed.id, revoked.id, revoked.provider_id,
      'revoke', revoked.credential_generation, now()
    from revoked
    join changed on changed.credential_reference_id = revoked.id
    on conflict (credential_reference_id, operation) do update set
      credential_generation = case
        when connector_oauth_lifecycle_jobs.state in (
          'leased', 'succeeded', 'permanent_failure'
        ) then connector_oauth_lifecycle_jobs.credential_generation
        else excluded.credential_generation
      end,
      state = case
        when connector_oauth_lifecycle_jobs.state in (
          'leased', 'succeeded', 'permanent_failure'
        )
          then connector_oauth_lifecycle_jobs.state
        else 'pending'
      end,
      next_attempt_at = case
        when connector_oauth_lifecycle_jobs.state in (
          'leased', 'succeeded', 'permanent_failure'
        )
          then connector_oauth_lifecycle_jobs.next_attempt_at
        else now()
      end,
      attempt_count = case
        when connector_oauth_lifecycle_jobs.state in (
          'leased', 'succeeded', 'permanent_failure'
        ) then connector_oauth_lifecycle_jobs.attempt_count else 0 end,
      lease_token = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.lease_token else null end,
      lease_expires_at = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.lease_expires_at else null end,
      lease_rotation_fingerprint = case
        when connector_oauth_lifecycle_jobs.state = 'leased'
          then connector_oauth_lifecycle_jobs.lease_rotation_fingerprint
        else null
      end,
      last_finished_lease_token = case
        when connector_oauth_lifecycle_jobs.state in ('succeeded', 'permanent_failure')
          then connector_oauth_lifecycle_jobs.last_finished_lease_token
        else null
      end,
      last_finished_outcome = case
        when connector_oauth_lifecycle_jobs.state in ('succeeded', 'permanent_failure')
          then connector_oauth_lifecycle_jobs.last_finished_outcome
        else null
      end,
      last_finished_fingerprint = case
        when connector_oauth_lifecycle_jobs.state in ('succeeded', 'permanent_failure')
          then connector_oauth_lifecycle_jobs.last_finished_fingerprint
        else null
      end,
      last_error_code = case
        when connector_oauth_lifecycle_jobs.state = 'permanent_failure'
          then connector_oauth_lifecycle_jobs.last_error_code
        else null
      end,
      completed_at = case when connector_oauth_lifecycle_jobs.state in (
        'succeeded', 'permanent_failure'
      ) then connector_oauth_lifecycle_jobs.completed_at else null end,
      updated_at = now()
    returning id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select changed.brand_id, changed.id, 'credential.status_changed', 'success',
    gen_random_uuid(), 'system', jsonb_build_object(
      'status', 'disabled', 'reason', 'provider_unavailable'
    ) from changed;
  return new;
end $lifecycle$;
revoke all on function app.invalidate_connector_provider_availability()
  from public, anon, authenticated, service_role;
drop trigger if exists connector_registry_invalidate_installations
  on public.connector_registry;
create trigger connector_registry_invalidate_installations
  after update of is_active, availability, adapter_contract_version
  on public.connector_registry
  for each row when (
    old.is_active is distinct from new.is_active
    or old.availability is distinct from new.availability
    or old.adapter_contract_version is distinct from new.adapter_contract_version
  ) execute function app.invalidate_connector_provider_availability();

create function app.invalidate_connector_capability_contract()
returns trigger language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_capability_key text;
  v_provider_id uuid;
begin
  if tg_op = 'DELETE' then
    v_capability_key := old.capability_key;
    v_provider_id := old.provider_id;
  else
    v_capability_key := new.capability_key;
    v_provider_id := new.provider_id;
  end if;
  with changed as (
    update public.connector_installations installation set
      status = 'reauthorization_required', enabled_capabilities = '{}',
      updated_at = now()
    from public.credential_references reference
    where installation.provider_id = v_provider_id
      and installation.status in ('connected_healthy', 'connected_degraded')
      and v_capability_key = any(installation.enabled_capabilities)
      and reference.id = installation.credential_reference_id
      and reference.brand_id = installation.brand_id
      and not exists (
        select 1 from public.connector_capabilities capability
        where capability.provider_id = v_provider_id
          and capability.capability_key = v_capability_key
          and capability.is_active
          and (cardinality(capability.oauth_scopes) = 0
            or (capability.oauth_scopes <@ reference.granted_scopes
              and case when jsonb_typeof(
                installation.settings->'oauthRequestedScopes'
              ) = 'array' then capability.oauth_scopes <@ array(
                select jsonb_array_elements_text(
                  installation.settings->'oauthRequestedScopes'
                )
              ) else false end))
          and exists (
            select 1 from public.connector_certifications certification
            where certification.capability_id = capability.id
              and certification.environment = 'sandbox'
              and certification.status = 'passed'
              and certification.contract_version = (
                select registry.adapter_contract_version
                from public.connector_registry registry
                where registry.id = v_provider_id
              )
              and certification.certified_at is not null
              and (certification.valid_until is null
                or certification.valid_until > now())
          )
      )
    returning installation.id, installation.brand_id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select changed.brand_id, changed.id, 'credential.status_changed', 'success',
    gen_random_uuid(), 'system', jsonb_build_object(
      'status', 'reauthorization_required', 'reason', 'capability_invalidated'
    ) from changed;
  return null;
end $lifecycle$;
revoke all on function app.invalidate_connector_capability_contract()
  from public, anon, authenticated, service_role;
drop trigger if exists connector_capabilities_invalidate_installations
  on public.connector_capabilities;
create trigger connector_capabilities_invalidate_installations
  after update of is_active, oauth_scopes or delete on public.connector_capabilities
  for each row execute function app.invalidate_connector_capability_contract();

create function app.protect_connector_contract_identity()
returns trigger language plpgsql security invoker set search_path = '' as $lifecycle$
begin
  if tg_table_name = 'connector_capabilities' and (
    new.provider_id is distinct from old.provider_id
    or new.capability_key is distinct from old.capability_key
  ) then
    raise exception using errcode = '23514',
      message = 'connector_capability_identity_immutable';
  end if;
  if tg_table_name = 'connector_certifications' and (
    new.capability_id is distinct from old.capability_id
    or new.environment is distinct from old.environment
    or new.contract_version is distinct from old.contract_version
  ) then
    raise exception using errcode = '23514',
      message = 'connector_certification_identity_immutable';
  end if;
  return new;
end $lifecycle$;
revoke all on function app.protect_connector_contract_identity()
  from public, anon, authenticated, service_role;
drop trigger if exists connector_capabilities_protect_identity
  on public.connector_capabilities;
create trigger connector_capabilities_protect_identity
  before update of provider_id, capability_key on public.connector_capabilities
  for each row execute function app.protect_connector_contract_identity();

create function app.invalidate_connector_certification_contract()
returns trigger language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_capability_id uuid;
begin
  v_capability_id := case when tg_op = 'DELETE'
    then old.capability_id else new.capability_id end;
  if exists (
    select 1 from public.connector_certifications certification
    where certification.capability_id = v_capability_id
      and certification.environment = 'sandbox'
      and certification.status = 'passed'
      and certification.contract_version = (
        select provider.adapter_contract_version
        from public.connector_capabilities capability
        join public.connector_registry provider on provider.id = capability.provider_id
        where capability.id = v_capability_id
      )
      and certification.certified_at is not null
      and (certification.valid_until is null or certification.valid_until > now())
  ) then
    return null;
  end if;
  with changed as (
    update public.connector_installations installation set
      status = 'reauthorization_required', enabled_capabilities = '{}',
      updated_at = now()
    from public.connector_capabilities capability
    where capability.id = v_capability_id
      and installation.provider_id = capability.provider_id
      and capability.capability_key = any(installation.enabled_capabilities)
      and installation.status in ('connected_healthy', 'connected_degraded')
    returning installation.id, installation.brand_id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select changed.brand_id, changed.id, 'credential.status_changed', 'success',
    gen_random_uuid(), 'system', jsonb_build_object(
      'status', 'reauthorization_required', 'reason', 'certification_invalidated'
    ) from changed;
  return null;
end $lifecycle$;
revoke all on function app.invalidate_connector_certification_contract()
  from public, anon, authenticated, service_role;
drop trigger if exists connector_certifications_invalidate_installations
  on public.connector_certifications;
create trigger connector_certifications_invalidate_installations
  after update of status, certified_at, valid_until or delete
  on public.connector_certifications
  for each row execute function app.invalidate_connector_certification_contract();
drop trigger if exists connector_certifications_protect_identity
  on public.connector_certifications;
create trigger connector_certifications_protect_identity
  before update of capability_id, environment, contract_version
  on public.connector_certifications
  for each row execute function app.protect_connector_contract_identity();

create function app.protect_connector_provider_identity()
returns trigger language plpgsql security invoker set search_path = '' as $lifecycle$
begin
  if new.provider_key is distinct from old.provider_key
    or new.oauth_lifecycle_managed is distinct from old.oauth_lifecycle_managed
    or new.oauth_refresh_managed is distinct from old.oauth_refresh_managed
    or new.oauth_revocation_scope is distinct from old.oauth_revocation_scope
    or new.oauth_grant_namespace is distinct from old.oauth_grant_namespace then
    raise exception using errcode = '23514',
      message = 'connector_provider_lifecycle_identity_immutable';
  end if;
  return new;
end $lifecycle$;
revoke all on function app.protect_connector_provider_identity()
  from public, anon, authenticated, service_role;
drop trigger if exists connector_registry_protect_identity
  on public.connector_registry;
create trigger connector_registry_protect_identity
  before update of provider_key, oauth_lifecycle_managed, oauth_refresh_managed,
    oauth_revocation_scope, oauth_grant_namespace on public.connector_registry
  for each row execute function app.protect_connector_provider_identity();

create or replace function public.disconnect_connector_oauth_connection(
  p_brand_id uuid,
  p_provider_key text,
  p_actor_user_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_installation public.connector_installations%rowtype;
  v_grant_namespace text;
  v_provider_id uuid;
begin
  if p_brand_id is null or p_actor_user_id is null
    or p_provider_key is null or length(p_provider_key) not between 1 and 80
    or not exists (
      select 1 from public.brand_users member
      where member.user_id = p_actor_user_id
        and (member.role = 'platform_admin'
          or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
    ) then
    raise exception using errcode = '42501', message = 'connector_oauth_forbidden';
  end if;

  select provider.id, provider.oauth_grant_namespace
  into v_provider_id, v_grant_namespace
  from public.connector_registry provider
  where provider.provider_key = p_provider_key
    and provider.oauth_lifecycle_managed
  for update;
  if v_provider_id is null then return false; end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_grant_namespace for update;

  select target.* into v_installation
  from public.connector_installations target
  where target.brand_id = p_brand_id
    and target.provider_id = v_provider_id
    and target.environment = 'production'
  for update;
  if not found then return false; end if;

  update app_private.connector_oauth_states state
  set consumed_at = coalesce(state.consumed_at, now()),
      superseded_at = coalesce(state.superseded_at, now())
  where state.installation_id = v_installation.id
    and state.brand_id = p_brand_id
    and state.superseded_at is null;

  if v_installation.status = 'revoked'
    and v_installation.credential_reference_id is null then
    return true;
  end if;

  update public.connector_installations installation set
    status = 'revoked',
    enabled_capabilities = '{}',
    external_account_label = '',
    connected_by = null,
    connected_at = null,
    last_synced_at = null,
    disabled_at = coalesce(installation.disabled_at, now()),
    updated_at = now()
  where installation.id = v_installation.id;
  update public.connector_location_mappings mapping
  set is_active = false, updated_at = now()
  where mapping.installation_id = v_installation.id
    and mapping.brand_id = p_brand_id
    and mapping.is_active;

  if v_installation.credential_reference_id is not null then
    update public.credential_references reference set
      revoked_at = coalesce(reference.revoked_at, now()),
      updated_at = now()
    where reference.id = v_installation.credential_reference_id
      and reference.brand_id = p_brand_id;
    update app_private.connector_oauth_lifecycle_jobs job set
      state = case when job.state = 'leased' then 'leased' else 'cancelled' end,
      cancel_requested = true,
      lease_token = case when job.state = 'leased' then job.lease_token else null end,
      lease_expires_at = case
        when job.state = 'leased' then job.lease_expires_at else null end,
      completed_at = case when job.state = 'leased' then null else now() end,
      updated_at = now()
    where job.credential_reference_id = v_installation.credential_reference_id
      and job.operation = 'refresh'
      and job.state not in ('succeeded', 'cancelled');
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) select
      reference.brand_id, v_installation.id, reference.id, reference.provider_id,
      'revoke', reference.credential_generation, now()
    from public.credential_references reference
    where reference.id = v_installation.credential_reference_id
      and reference.brand_id = p_brand_id
    on conflict (credential_reference_id, operation) do update set
      credential_generation = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded'
      ) then connector_oauth_lifecycle_jobs.credential_generation
        else excluded.credential_generation end,
      state = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded'
      ) then connector_oauth_lifecycle_jobs.state else 'pending' end,
      attempt_count = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded'
      ) then connector_oauth_lifecycle_jobs.attempt_count else 0 end,
      next_attempt_at = case when connector_oauth_lifecycle_jobs.state in (
        'leased', 'succeeded'
      ) then connector_oauth_lifecycle_jobs.next_attempt_at else now() end,
      lease_token = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.lease_token else null end,
      lease_expires_at = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.lease_expires_at else null end,
      lease_rotation_fingerprint = case
        when connector_oauth_lifecycle_jobs.state = 'leased'
          then connector_oauth_lifecycle_jobs.lease_rotation_fingerprint
        else null end,
      last_finished_lease_token = case
        when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.last_finished_lease_token else null end,
      last_finished_outcome = case
        when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.last_finished_outcome else null end,
      last_finished_fingerprint = case
        when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.last_finished_fingerprint else null end,
      cancel_requested = case when connector_oauth_lifecycle_jobs.state = 'leased'
        then connector_oauth_lifecycle_jobs.cancel_requested else false end,
      last_error_code = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
        then connector_oauth_lifecycle_jobs.last_error_code else null end,
      completed_at = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
        then connector_oauth_lifecycle_jobs.completed_at else null end,
      updated_at = now();
  end if;

  if v_installation.status <> 'revoked' then
    insert into public.connector_audit_events (
      brand_id, installation_id, actor_user_id, action, outcome,
      correlation_id, source, detail
    ) values (
      p_brand_id, v_installation.id, p_actor_user_id, 'oauth.disconnected',
      'success', gen_random_uuid(), 'hq', jsonb_build_object(
        'provider', p_provider_key,
        'revocationQueued', v_installation.credential_reference_id is not null,
        'localAccessDisabled', true
      )
    );
  end if;
  return true;
end $lifecycle$;

create function app.connector_identity_credential_valid(p_credential_text text)
returns boolean language plpgsql stable security invoker set search_path = '' as $lifecycle$
declare
  v_credential jsonb;
begin
  v_credential := app.try_connector_credential_json(p_credential_text);
  return coalesce(v_credential is not null
    and pg_column_size(v_credential) <= 24576
    and jsonb_typeof(v_credential->'access_token') = 'string'
    and octet_length(v_credential->>'access_token') between 8 and 16384, false);
end $lifecycle$;
revoke all on function app.connector_identity_credential_valid(text)
  from public, anon, authenticated, service_role;

create function public.start_connector_oauth_credential_rotation(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_namespace text;
  v_provider_id uuid;
begin
  if p_job_id is null or p_lease_token is null or p_now is null then
    raise exception using errcode = '22023', message = 'connector_oauth_rotation_invalid';
  end if;
  select job.installation_id, job.provider_id
  into v_installation_id, v_provider_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  select provider.oauth_grant_namespace into v_namespace
  from public.connector_registry provider
  where provider.id = v_provider_id and provider.oauth_lifecycle_managed
    and (provider.oauth_refresh_managed
      or provider.provider_key = 'meta-business-suite')
  for share;
  if not found then return false; end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_namespace for update;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;
  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.operation not in ('identify', 'refresh', 'revoke')
    or v_job.state <> 'leased' or v_job.lease_token <> p_lease_token then
    return false;
  end if;
  if v_job.lease_expires_at <= p_now then return false; end if;
  if v_job.lease_rotation_started_at is not null then return true; end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    lease_rotation_started_at = p_now,
    lease_expires_at = greatest(job.lease_expires_at, p_now + interval '2 minutes'),
    updated_at = p_now
  where job.id = v_job.id and job.state = 'leased'
    and job.lease_token = p_lease_token;
  return found;
end $lifecycle$;

create function public.cancel_connector_oauth_credential_rotation(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
begin
  if p_job_id is null or p_lease_token is null or p_now is null then
    raise exception using errcode = '22023', message = 'connector_oauth_rotation_invalid';
  end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    lease_rotation_started_at = null,
    updated_at = p_now
  where job.id = p_job_id
    and job.state = 'leased'
    and job.lease_token = p_lease_token
    and job.lease_expires_at > p_now
    and job.lease_rotation_started_at is not null
    and job.lease_rotation_fingerprint is null;
  if found then return true; end if;
  return exists (
    select 1 from app_private.connector_oauth_lifecycle_jobs job
    where job.id = p_job_id and job.state = 'leased'
      and job.lease_token = p_lease_token
      and job.lease_expires_at > p_now
      and job.lease_rotation_started_at is null
      and job.lease_rotation_fingerprint is null
  );
end $lifecycle$;

create function public.claim_connector_oauth_identities(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  job_id uuid,
  brand_id uuid,
  installation_id uuid,
  credential_reference_id uuid,
  provider_key text,
  credential_generation bigint,
  lease_token uuid,
  credential jsonb,
  account_label text,
  expires_at timestamptz,
  granted_scopes text[],
  identity_hint jsonb
)
language plpgsql security definer set search_path = '' as $lifecycle$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception using errcode = '22023', message = 'connector_oauth_claim_invalid';
  end if;

  with ambiguous as (
    select job.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.connector_registry provider on provider.id = job.provider_id
    where job.operation = 'identify' and job.state = 'leased'
      and job.lease_expires_at <= p_now
      and job.lease_rotation_started_at is not null
      and provider.provider_key in ('slack', 'tiktok')
    order by job.lease_expires_at, job.created_at, job.id
    for update of job skip locked limit p_limit
  ), fenced as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous where job.id = ambiguous.id returning job.*
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select fenced.brand_id, fenced.installation_id,
    'oauth.identity_failed', 'failure', gen_random_uuid(), 'cron',
    jsonb_build_object('errorCode', 'rotation_ambiguous', 'retryable', false)
  from fenced;

  with invalid as (
    select job.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    left join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'identify'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and app.connector_identity_credential_valid(secret.decrypted_secret) is not true
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked limit p_limit
  ), quarantined as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'credential_malformed', completed_at = p_now,
      updated_at = p_now
    from invalid where job.id = invalid.id returning job.*
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select quarantined.brand_id, quarantined.installation_id,
    'oauth.identity_failed', 'failure', gen_random_uuid(), 'cron',
    jsonb_build_object('errorCode', 'credential_malformed', 'retryable', false)
  from quarantined;

  return query
  with candidates as (
    select job.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'identify'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and provider.oauth_lifecycle_managed
      and provider.oauth_revocation_scope = 'grant'
      and app.connector_identity_credential_valid(secret.decrypted_secret) is true
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked limit p_limit
  ), leased as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'leased', attempt_count = least(job.attempt_count + 1, 50),
      lease_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      lease_rotation_started_at = null,
      lease_rotation_fingerprint = null,
      last_error_code = null, completed_at = null, updated_at = p_now
    from candidates where job.id = candidates.id returning job.*
  )
  select leased.id, leased.brand_id, leased.installation_id,
    leased.credential_reference_id, provider.provider_key,
    leased.credential_generation, leased.lease_token,
    app.try_connector_credential_json(secret.decrypted_secret),
    reference.account_label, reference.expires_at, reference.granted_scopes,
    leased.identity_hint
  from leased
  join public.credential_references reference
    on reference.id = leased.credential_reference_id
   and reference.brand_id = leased.brand_id
  join public.connector_registry provider on provider.id = leased.provider_id
  join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
  order by leased.next_attempt_at, leased.created_at, leased.id;
end $lifecycle$;

create function public.rotate_connector_oauth_identity_credential(
  p_job_id uuid,
  p_lease_token uuid,
  p_credential jsonb,
  p_expires_at timestamptz,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_effective_scopes text[];
  v_fingerprint text;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_namespace text;
  v_provider_id uuid;
  v_refresh_managed boolean;
  v_provider_key text;
  v_reference public.credential_references%rowtype;
  v_stored_credential jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_expires_at is null or p_expires_at <= p_now
    or jsonb_typeof(p_credential) is distinct from 'object'
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or (p_credential ? 'refresh_token' and (
      jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
      or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    )) then
    raise exception using errcode = '22023', message = 'connector_oauth_rotation_invalid';
  end if;
  if p_credential ? 'granted_scopes' and (
    jsonb_typeof(p_credential->'granted_scopes') is distinct from 'array'
    or jsonb_array_length(p_credential->'granted_scopes') > 32
    or exists (
      select 1 from jsonb_array_elements(p_credential->'granted_scopes') item(value)
      where jsonb_typeof(item.value) is distinct from 'string'
        or octet_length(item.value #>> '{}') not between 1 and 512
    )
  ) then
    raise exception using errcode = '22023', message = 'connector_oauth_rotation_invalid';
  end if;
  v_stored_credential := (p_credential - 'granted_scopes') - 'external_account_id';
  if pg_column_size(v_stored_credential) > 24576 then
    raise exception using errcode = '22023', message = 'connector_oauth_rotation_invalid';
  end if;

  select job.installation_id, job.provider_id
  into v_installation_id, v_provider_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  select provider.oauth_grant_namespace, provider.oauth_refresh_managed,
    provider.provider_key
  into v_namespace, v_refresh_managed, v_provider_key
  from public.connector_registry provider
  where provider.id = v_provider_id and provider.oauth_lifecycle_managed
    and provider.oauth_revocation_scope = 'grant'
    and (provider.oauth_refresh_managed
      or provider.provider_key = 'meta-business-suite')
  for share;
  if not found then return false; end if;
  if (v_refresh_managed and (
      jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
      or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    )) or (v_provider_key = 'meta-business-suite'
      and p_expires_at > p_now + interval '90 days')
    or (v_provider_key <> 'meta-business-suite'
      and p_expires_at > p_now + interval '30 days') then
    raise exception using errcode = '22023', message = 'connector_oauth_rotation_invalid';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_namespace for update;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;
  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.operation <> 'identify' or v_job.state <> 'leased'
    or v_job.lease_token <> p_lease_token then return false; end if;

  select reference.* into v_reference
  from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
    and reference.credential_generation = v_job.credential_generation
  for update;
  if not found or v_reference.external_account_fingerprint is not null then
    return false;
  end if;

  if p_credential ? 'granted_scopes' then
    select coalesce(array_agg(distinct item.value order by item.value), '{}')
    into v_effective_scopes
    from jsonb_array_elements_text(p_credential->'granted_scopes') item(value)
    where item.value = any(v_reference.granted_scopes);
  else
    v_effective_scopes := v_reference.granted_scopes;
  end if;
  v_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'credential', v_stored_credential,
      'grantedScopes', to_jsonb(v_effective_scopes),
      'expiresAt', to_jsonb(p_expires_at)
    )::text, 'sha256'
  ), 'hex');
  if v_job.lease_rotation_fingerprint is not null then
    return v_job.lease_rotation_fingerprint = v_fingerprint;
  end if;
  if v_job.lease_rotation_started_at is null then return false; end if;

  perform vault.update_secret(
    v_reference.vault_secret_id, v_stored_credential::text, null::text, null::text
  );
  update public.credential_references reference set
    granted_scopes = v_effective_scopes,
    expires_at = p_expires_at,
    last_rotated_at = p_now,
    credential_generation = reference.credential_generation + 1,
    updated_at = p_now
  where reference.id = v_reference.id
    and reference.brand_id = v_reference.brand_id
    and reference.credential_generation = v_job.credential_generation;
  if not found then return false; end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    credential_generation = job.credential_generation + 1,
    lease_rotation_started_at = null,
    lease_rotation_fingerprint = v_fingerprint,
    updated_at = p_now
  where job.id = v_job.id and job.state = 'leased'
    and job.lease_token = p_lease_token
    and job.credential_generation = v_job.credential_generation;
  if not found then return false; end if;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.identity_credential_rotated',
    'success', p_lease_token, 'cron', jsonb_build_object(
      'previousGeneration', v_job.credential_generation,
      'credentialGeneration', v_job.credential_generation + 1
    )
  );
  return true;
end $lifecycle$;

create function public.complete_connector_oauth_identity(
  p_job_id uuid,
  p_lease_token uuid,
  p_external_account_id text,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_credential jsonb;
  v_fingerprint text;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_outcome_fingerprint text;
  v_provider public.connector_registry%rowtype;
  v_provider_id uuid;
  v_reference public.credential_references%rowtype;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_external_account_id is null
    or octet_length(p_external_account_id) not between 1 and 512 then
    raise exception using errcode = '22023', message = 'connector_oauth_identity_invalid';
  end if;
  v_outcome_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object('externalAccountId', p_external_account_id)::text,
    'sha256'), 'hex');
  select job.installation_id, job.provider_id
  into v_installation_id, v_provider_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  select provider.* into v_provider
  from public.connector_registry provider
  where provider.id = v_provider_id and provider.oauth_lifecycle_managed
    and provider.oauth_revocation_scope = 'grant' for update;
  if not found then return false; end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_provider.oauth_grant_namespace for update;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;
  select job.* into v_job from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.identity_finished_lease_token = p_lease_token then
    return v_job.identity_finished_fingerprint = v_outcome_fingerprint;
  end if;
  if v_job.last_finished_lease_token = p_lease_token
    or v_job.operation <> 'identify' or v_job.state <> 'leased'
    or v_job.lease_token <> p_lease_token then
    return false;
  end if;
  select reference.* into v_reference
  from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
    and reference.credential_generation = v_job.credential_generation
  for update;
  if not found then return false; end if;
  select app.try_connector_credential_json(secret.decrypted_secret)
  into v_credential from vault.decrypted_secrets secret
  where secret.id = v_reference.vault_secret_id;
  if not app.connector_identity_credential_valid(v_credential::text) then
    return false;
  end if;
  v_credential := jsonb_set(
    v_credential, '{external_account_id}', to_jsonb(p_external_account_id), true
  );
  if pg_column_size(v_credential) > 24576 then
    raise exception using errcode = '22023', message = 'connector_oauth_identity_invalid';
  end if;
  v_fingerprint := app.connector_external_account_fingerprint(
    v_job.provider_id, v_credential::text
  );
  if v_fingerprint is null then
    raise exception using errcode = '22023', message = 'connector_oauth_identity_invalid';
  end if;
  perform vault.update_secret(
    v_reference.vault_secret_id, v_credential::text, null::text, null::text
  );
  update public.credential_references reference set
    external_account_fingerprint = v_fingerprint,
    credential_generation = reference.credential_generation + 1,
    updated_at = p_now
  where reference.id = v_reference.id
    and reference.credential_generation = v_job.credential_generation;
  if not found then return false; end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    operation = 'revoke', state = 'pending', attempt_count = 0,
    credential_generation = job.credential_generation + 1,
    next_attempt_at = p_now + interval '31 minutes',
    lease_token = null, lease_expires_at = null,
    lease_rotation_started_at = null,
    lease_rotation_fingerprint = null,
    identity_finished_lease_token = p_lease_token,
    identity_finished_fingerprint = v_outcome_fingerprint,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'completed',
    last_finished_fingerprint = v_outcome_fingerprint,
    last_error_code = null, completed_at = null, updated_at = p_now
  where job.id = v_job.id and job.operation = 'identify'
    and job.state = 'leased' and job.lease_token = p_lease_token;
  if not found then return false; end if;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.identity_resolved',
    'success', p_lease_token, 'cron',
    jsonb_build_object('credentialGeneration', v_job.credential_generation + 1)
  );
  return true;
end $lifecycle$;

create function public.fail_connector_oauth_identity(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_failure_fingerprint text;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_permanent boolean;
  v_provider_key text;
  v_recorded_error text;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_retryable is null or p_error_code is null
    or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'connector_oauth_failure_invalid';
  end if;
  v_failure_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object('errorCode',p_error_code,'retryable',p_retryable)::text,
    'sha256'), 'hex');
  select job.* into v_job from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if not found then return false; end if;
  if v_job.identity_finished_lease_token = p_lease_token then return false; end if;
  if v_job.last_finished_lease_token = p_lease_token then
    return v_job.last_finished_outcome = 'failed'
      and v_job.last_finished_fingerprint = v_failure_fingerprint;
  end if;
  if v_job.operation <> 'identify' or v_job.state <> 'leased'
    or v_job.lease_token <> p_lease_token then return false; end if;
  select provider.provider_key into v_provider_key
  from public.connector_registry provider where provider.id = v_job.provider_id;
  v_permanent := not p_retryable or (
    v_job.lease_rotation_started_at is not null
    and v_job.lease_rotation_fingerprint is null
    and v_provider_key in ('slack', 'tiktok')
  );
  v_recorded_error := case when p_retryable and v_permanent
    then 'rotation_ambiguous' else p_error_code end;
  update app_private.connector_oauth_lifecycle_jobs job set
    state = case when v_permanent then 'permanent_failure' else 'pending' end,
    next_attempt_at = case when v_permanent then job.next_attempt_at else
      p_now + make_interval(secs => least(
        21600, (60 * power(2, least(job.attempt_count - 1, 8)))::integer
      )) end,
    lease_token = null, lease_expires_at = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'failed',
    last_finished_fingerprint = v_failure_fingerprint,
    lease_rotation_started_at = case when v_permanent
      then job.lease_rotation_started_at else null end,
    lease_rotation_fingerprint = case when v_permanent
      then job.lease_rotation_fingerprint else null end,
    last_error_code = v_recorded_error,
    completed_at = case when v_permanent then p_now else null end,
    updated_at = p_now
  where job.id = v_job.id;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.identity_failed',
    'failure', p_lease_token, 'cron', jsonb_build_object(
      'errorCode', v_recorded_error, 'retryable', not v_permanent,
      'attempt', v_job.attempt_count
    )
  );
  return true;
end $lifecycle$;

create function public.claim_connector_oauth_revocations(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  job_id uuid,
  brand_id uuid,
  installation_id uuid,
  credential_reference_id uuid,
  provider_key text,
  credential_generation bigint,
  lease_token uuid,
  credential jsonb,
  account_label text,
  granted_scopes text[]
)
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_local_token uuid;
  v_maintenance_count integer;
  v_shared record;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception using errcode = '22023', message = 'connector_oauth_claim_invalid';
  end if;

  -- Namespace rows serialize authorization completion with grant-wide claims.
  perform 1
  from app_private.connector_oauth_grant_namespaces grant_namespace
  order by grant_namespace.namespace
  for update;

  -- An expired lease from a rotating-token adapter is ambiguous: the provider
  -- may have issued a one-use replacement that never reached this database.
  with ambiguous_candidates as (
    select job.id, job.lease_token as expired_lease_token
    from app_private.connector_oauth_lifecycle_jobs job
    join public.connector_registry provider on provider.id = job.provider_id
    where job.operation = 'revoke' and job.state = 'leased'
      and job.lease_expires_at <= p_now
      and job.lease_rotation_started_at is not null
      and job.lease_rotation_fingerprint is null
      and provider.provider_key in ('slack', 'tiktok')
    order by job.lease_expires_at, job.id
    for update of job skip locked
    limit p_limit
  ), ambiguous as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = ambiguous_candidate.expired_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = pg_catalog.encode(public.digest(
        jsonb_build_object(
          'errorCode', 'rotation_ambiguous', 'retryable', false
        )::text, 'sha256'
      ), 'hex'),
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_candidates ambiguous_candidate
    where job.id = ambiguous_candidate.id
    returning job.*, ambiguous_candidate.expired_lease_token
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select ambiguous.brand_id, ambiguous.installation_id,
    'oauth.revocation_failed', 'failure', ambiguous.expired_lease_token,
    'cron', jsonb_build_object(
      'errorCode', 'rotation_ambiguous', 'retryable', false
    )
  from ambiguous;

  -- Disconnect can race an in-flight refresh. Reusable-token providers are
  -- fenced after lease expiry; rotating-token providers retain manual evidence.
  with ambiguous_refresh_candidates as (
    select refresh_job.id, refresh_job.credential_reference_id,
      refresh_job.lease_token as expired_lease_token
    from app_private.connector_oauth_lifecycle_jobs refresh_job
    join public.connector_registry provider on provider.id = refresh_job.provider_id
    where refresh_job.operation = 'refresh' and refresh_job.cancel_requested
      and ((refresh_job.state = 'leased'
          and refresh_job.lease_expires_at <= p_now
          and refresh_job.lease_rotation_started_at is not null
          and refresh_job.lease_rotation_fingerprint is null
          and provider.provider_key in ('slack', 'tiktok'))
        or (provider.provider_key = 'quickbooks-online'
          and refresh_job.rotation_replay_deadline <= p_now
          and (refresh_job.state = 'pending' or (
            refresh_job.state = 'leased'
            and refresh_job.lease_expires_at <= p_now))))
    order by refresh_job.lease_expires_at, refresh_job.id
    for update of refresh_job skip locked
    limit p_limit
  ), ambiguous_refreshes as (
    update app_private.connector_oauth_lifecycle_jobs refresh_job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = candidate.expired_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = pg_catalog.encode(public.digest(
        jsonb_build_object(
          'errorCode', 'rotation_ambiguous', 'retryable', false
        )::text, 'sha256'
      ), 'hex'),
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_refresh_candidates candidate
    where refresh_job.id = candidate.id
    returning refresh_job.*, candidate.expired_lease_token
  ), blocked_revocations as (
    update app_private.connector_oauth_lifecycle_jobs revoke_job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_refreshes refresh_job
    where revoke_job.credential_reference_id = refresh_job.credential_reference_id
      and revoke_job.operation = 'revoke'
      and revoke_job.state not in ('leased', 'succeeded')
    returning revoke_job.id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select refresh_job.brand_id, refresh_job.installation_id,
    'oauth.refresh_failed', 'failure', refresh_job.expired_lease_token,
    'cron', jsonb_build_object(
      'errorCode', 'rotation_ambiguous', 'retryable', false,
      'revocationBlocked', true
    )
  from ambiguous_refreshes refresh_job;

  with fence_candidates as (
    select refresh_job.id
    from app_private.connector_oauth_lifecycle_jobs refresh_job
    join public.connector_registry provider on provider.id = refresh_job.provider_id
    where refresh_job.operation = 'refresh'
      and refresh_job.state = 'leased' and refresh_job.cancel_requested
      and refresh_job.lease_expires_at <= p_now
      and (provider.provider_key not in ('slack', 'tiktok', 'quickbooks-online')
        or refresh_job.lease_rotation_started_at is null
        or refresh_job.lease_rotation_fingerprint is not null)
    order by refresh_job.lease_expires_at, refresh_job.id
    for update of refresh_job skip locked
    limit least(p_limit * 2, 200)
  ), fenced_refreshes as (
    update app_private.connector_oauth_lifecycle_jobs refresh_job set
      state = 'cancelled', lease_token = null, lease_expires_at = null,
      last_error_code = 'lease_cancelled', completed_at = p_now,
      updated_at = p_now
    from fence_candidates candidate
    where refresh_job.id = candidate.id
    returning refresh_job.id
  )
  select count(*) into v_maintenance_count from fenced_refreshes;

  -- A grant-wide credential is retired locally when another live installation
  -- owns the same provider grant. Calling the provider would revoke that owner.
  for v_shared in
    select job.id, job.brand_id, job.installation_id,
      job.credential_reference_id, job.credential_generation
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'revoke' and job.state = 'pending'
      and job.next_attempt_at <= p_now
      and provider.oauth_lifecycle_managed
      and provider.oauth_revocation_scope = 'grant'
      and app.connector_job_credential_valid(
        job.provider_id, 'revoke', secret.decrypted_secret,
        reference.external_account_fingerprint
      )
      and not exists (
        select 1 from app_private.connector_oauth_lifecycle_jobs refresh_job
        where refresh_job.credential_reference_id = job.credential_reference_id
          and refresh_job.operation = 'refresh' and refresh_job.state = 'leased'
      )
      and exists (
        select 1
        from public.connector_installations live_installation
        join public.credential_references live_reference
          on live_reference.id = live_installation.credential_reference_id
         and live_reference.brand_id = live_installation.brand_id
        join public.connector_registry live_provider
          on live_provider.id = live_reference.provider_id
        where live_reference.id <> reference.id
          and live_reference.revoked_at is null
          and live_reference.external_account_fingerprint
            = reference.external_account_fingerprint
          and live_provider.oauth_grant_namespace = provider.oauth_grant_namespace
      )
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked
    limit p_limit
  loop
    v_local_token := gen_random_uuid();
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'succeeded', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = v_local_token,
      last_finished_outcome = 'completed', last_finished_fingerprint = null,
      last_error_code = 'shared_grant_retained', completed_at = p_now,
      updated_at = p_now
    where job.id = v_shared.id;
    perform public.revoke_connector_secret(
      v_shared.credential_reference_id, v_shared.brand_id
    );
    update public.connector_installations installation set
      credential_reference_id = null, updated_at = p_now
    where installation.id = v_shared.installation_id
      and installation.brand_id = v_shared.brand_id
      and installation.credential_reference_id = v_shared.credential_reference_id
      and installation.status in ('revoked', 'disabled');
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    ) values (
      v_shared.brand_id, v_shared.installation_id,
      'oauth.revocation_completed', 'success', v_local_token, 'cron',
      jsonb_build_object(
        'credentialGeneration', v_shared.credential_generation,
        'providerCallSkipped', true, 'reason', 'shared_grant_retained'
      )
    );
  end loop;

  with malformed_candidates as (
    select job.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    left join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'revoke'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and app.connector_job_credential_valid(
        job.provider_id, 'revoke', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is not true
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), quarantined as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'credential_malformed', completed_at = p_now,
      updated_at = p_now
    from malformed_candidates candidate where job.id = candidate.id
    returning job.*
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select quarantined.brand_id, quarantined.installation_id,
    'oauth.revocation_failed', 'failure', gen_random_uuid(), 'cron',
    jsonb_build_object('errorCode', 'credential_malformed', 'retryable', false)
  from quarantined;

  return query
  with eligible as (
    select job.id, provider.provider_key, job.next_attempt_at, job.created_at,
      row_number() over (
        partition by case when provider.oauth_revocation_scope = 'grant'
          then provider.oauth_grant_namespace || ':'
            || reference.external_account_fingerprint
          else job.id::text end
        order by job.next_attempt_at, job.created_at, job.id
      ) as grant_rank
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'revoke'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and provider.oauth_lifecycle_managed
      and app.connector_job_credential_valid(
        job.provider_id, 'revoke', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is true
      and not exists (
        select 1 from app_private.connector_oauth_lifecycle_jobs refresh_job
        where refresh_job.credential_reference_id = job.credential_reference_id
          and refresh_job.operation = 'refresh' and refresh_job.state = 'leased'
      )
      and (provider.oauth_revocation_scope = 'credential' or (
        not exists (
          select 1
          from public.connector_installations live_installation
          join public.credential_references live_reference
            on live_reference.id = live_installation.credential_reference_id
           and live_reference.brand_id = live_installation.brand_id
          join public.connector_registry live_provider
            on live_provider.id = live_reference.provider_id
          where live_reference.revoked_at is null
            and live_reference.external_account_fingerprint
              = reference.external_account_fingerprint
            and live_provider.oauth_grant_namespace
              = provider.oauth_grant_namespace
        )
        and not exists (
          select 1
          from app_private.connector_oauth_lifecycle_jobs leased_sibling
          join public.credential_references sibling_reference
            on sibling_reference.id = leased_sibling.credential_reference_id
           and sibling_reference.brand_id = leased_sibling.brand_id
          join public.connector_registry sibling_provider
            on sibling_provider.id = leased_sibling.provider_id
          where leased_sibling.id <> job.id
            and leased_sibling.operation = 'revoke'
            and leased_sibling.state = 'leased'
            and sibling_provider.oauth_grant_namespace
              = provider.oauth_grant_namespace
            and sibling_reference.external_account_fingerprint
              = reference.external_account_fingerprint
        )
      ))
  ), candidates as (
    select job.id, eligible.provider_key
    from eligible
    join app_private.connector_oauth_lifecycle_jobs job on job.id = eligible.id
    where eligible.grant_rank = 1
    order by eligible.next_attempt_at, eligible.created_at, eligible.id
    for update of job skip locked
    limit p_limit
  ), leased as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'leased', attempt_count = least(job.attempt_count + 1, 50),
      lease_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      rotation_replay_deadline = job.rotation_replay_deadline,
      lease_rotation_started_at = null,
      lease_rotation_fingerprint = null,
      last_error_code = null, completed_at = null, updated_at = p_now
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select leased.id, leased.brand_id, leased.installation_id,
    leased.credential_reference_id, provider.provider_key,
    leased.credential_generation, leased.lease_token,
    app.try_connector_credential_json(secret.decrypted_secret),
    reference.account_label, reference.granted_scopes
  from leased
  join public.credential_references reference
    on reference.id = leased.credential_reference_id
   and reference.brand_id = leased.brand_id
  join public.connector_registry provider on provider.id = leased.provider_id
  join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
  order by leased.next_attempt_at, leased.created_at, leased.id;
end $lifecycle$;

create function public.rotate_connector_oauth_revocation_credential(
  p_job_id uuid,
  p_lease_token uuid,
  p_credential jsonb,
  p_expires_at timestamptz,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_account_fingerprint text;
  v_effective_scopes text[];
  v_fingerprint text;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_reference public.credential_references%rowtype;
  v_stored_credential jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential - 'granted_scopes') > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or jsonb_typeof(p_credential->'external_account_id') is distinct from 'string'
    or octet_length(p_credential->>'external_account_id') not between 1 and 512
  then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;
  if p_credential ? 'refresh_token' and (
    jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
    or octet_length(p_credential->>'refresh_token') not between 8 and 16384
  ) then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;
  if p_credential ? 'granted_scopes' then
    if jsonb_typeof(p_credential->'granted_scopes') is distinct from 'array'
      or jsonb_array_length(p_credential->'granted_scopes') > 32
      or exists (
        select 1 from jsonb_array_elements(p_credential->'granted_scopes') item(value)
        where jsonb_typeof(item.value) is distinct from 'string'
          or length(item.value #>> '{}') not between 1 and 512
      ) then
      raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
    end if;
  end if;
  v_stored_credential := p_credential - 'granted_scopes';
  v_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'credential', p_credential, 'expiresAt', to_jsonb(p_expires_at)
    )::text, 'sha256'
  ), 'hex');

  select job.installation_id into v_installation_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;
  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.operation <> 'revoke' or v_job.state <> 'leased'
    or v_job.lease_token <> p_lease_token then
    return false;
  end if;
  if v_job.lease_rotation_fingerprint is not null then
    return v_job.lease_rotation_fingerprint = v_fingerprint;
  end if;
  if v_job.lease_rotation_started_at is null then return false; end if;
  if p_expires_at is not null and p_expires_at <= p_now then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;

  select reference.* into v_reference
  from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
  for update;
  if not found
    or v_reference.credential_generation <> v_job.credential_generation then
    return false;
  end if;
  v_account_fingerprint := app.connector_external_account_fingerprint(
    v_job.provider_id, p_credential::text
  );
  if v_reference.external_account_fingerprint is distinct from v_account_fingerprint then
    raise exception using errcode = '22023',
      message = 'connector_oauth_account_mismatch';
  end if;
  if p_credential ? 'granted_scopes' then
    select coalesce(array_agg(distinct item.value order by item.value), '{}')
    into v_effective_scopes
    from jsonb_array_elements_text(p_credential->'granted_scopes') item(value);
  else
    v_effective_scopes := v_reference.granted_scopes;
  end if;

  perform vault.update_secret(
    v_reference.vault_secret_id, v_stored_credential::text, null::text, null::text
  );
  update public.credential_references reference set
    granted_scopes = v_effective_scopes, expires_at = p_expires_at,
    last_rotated_at = p_now,
    credential_generation = reference.credential_generation + 1,
    updated_at = p_now
  where reference.id = v_reference.id
    and reference.brand_id = v_reference.brand_id
    and reference.credential_generation = v_job.credential_generation;
  if not found then return false; end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    credential_generation = job.credential_generation + 1,
    lease_rotation_started_at = null,
    lease_rotation_fingerprint = v_fingerprint,
    updated_at = p_now
  where job.id = v_job.id and job.state = 'leased'
    and job.lease_token = p_lease_token;
  if not found then return false; end if;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id,
    'oauth.revocation_credential_rotated', 'success', p_lease_token, 'cron',
    jsonb_build_object('credentialGeneration', v_job.credential_generation + 1)
  );
  return true;
end $lifecycle$;

create function public.complete_connector_oauth_revocation(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_reference_generation bigint;
begin
  if p_job_id is null or p_lease_token is null or p_now is null then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;
  select job.installation_id into v_installation_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;

  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.operation <> 'revoke' then return false; end if;
  if v_job.last_finished_lease_token = p_lease_token
    and v_job.last_finished_outcome = 'completed' then
    return true;
  end if;
  if v_job.state <> 'leased' or v_job.lease_token <> p_lease_token then
    return false;
  end if;

  select reference.credential_generation into v_reference_generation
  from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
  for update;
  if not found or v_reference_generation <> v_job.credential_generation then
    return false;
  end if;

  perform public.revoke_connector_secret(
    v_job.credential_reference_id, v_job.brand_id
  );
  update public.connector_installations installation set
    credential_reference_id = null, updated_at = p_now
  where installation.id = v_job.installation_id
    and installation.brand_id = v_job.brand_id
    and installation.credential_reference_id = v_job.credential_reference_id
    and installation.status in ('revoked', 'disabled');
  update app_private.connector_oauth_lifecycle_jobs job set
    state = 'succeeded', lease_token = null, lease_expires_at = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'completed', last_finished_fingerprint = null,
    last_error_code = null,
    completed_at = p_now, updated_at = p_now
  where job.id = v_job.id;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.revocation_completed',
    'success', p_lease_token, 'cron', jsonb_build_object(
      'credentialGeneration', v_job.credential_generation
    )
  );
  return true;
end $lifecycle$;

create function public.fail_connector_oauth_revocation(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_failure_fingerprint text;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_permanent boolean;
  v_provider_key text;
  v_recorded_error text;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_retryable is null or p_error_code is null
    or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'connector_oauth_failure_invalid';
  end if;
  v_failure_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'errorCode', p_error_code, 'retryable', p_retryable
    )::text, 'sha256'
  ), 'hex');
  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if not found or v_job.operation <> 'revoke' then return false; end if;
  if v_job.last_finished_lease_token = p_lease_token then
    return v_job.last_finished_outcome = 'failed'
      and v_job.last_finished_fingerprint = v_failure_fingerprint;
  end if;
  if v_job.state <> 'leased' or v_job.lease_token <> p_lease_token then
    return false;
  end if;
  select provider.provider_key into v_provider_key
  from public.connector_registry provider where provider.id = v_job.provider_id;
  v_permanent := not p_retryable or (
    v_job.lease_rotation_started_at is not null
    and v_job.lease_rotation_fingerprint is null
    and v_provider_key in ('slack', 'tiktok')
  );
  v_recorded_error := case when p_retryable and v_permanent
    then 'rotation_ambiguous' else p_error_code end;
  update app_private.connector_oauth_lifecycle_jobs job set
    state = case when v_permanent then 'permanent_failure' else 'pending' end,
    next_attempt_at = case when v_permanent then job.next_attempt_at else
      p_now + make_interval(secs => least(
        21600, (60 * power(2, least(job.attempt_count - 1, 8)))::integer
      )) end,
    lease_token = null, lease_expires_at = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'failed',
    last_finished_fingerprint = v_failure_fingerprint,
    lease_rotation_started_at = case when v_permanent
      then job.lease_rotation_started_at else null end,
    lease_rotation_fingerprint = case when v_permanent
      then job.lease_rotation_fingerprint else null end,
    last_error_code = v_recorded_error,
    completed_at = case when v_permanent then p_now else null end,
    updated_at = p_now
  where job.id = v_job.id;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.revocation_failed',
    'failure', p_lease_token, 'cron', jsonb_build_object(
      'errorCode', v_recorded_error, 'retryable', not v_permanent,
      'attempt', v_job.attempt_count
    )
  );
  return true;
end $lifecycle$;

create function public.claim_connector_oauth_refreshes(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  job_id uuid,
  brand_id uuid,
  installation_id uuid,
  credential_reference_id uuid,
  provider_key text,
  credential_generation bigint,
  lease_token uuid,
  credential jsonb,
  account_label text,
  expires_at timestamptz,
  granted_scopes text[]
)
language plpgsql security definer set search_path = '' as $lifecycle$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception using errcode = '22023', message = 'connector_oauth_claim_invalid';
  end if;
  with ambiguous_installations as (
    select installation.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.connector_installations installation
      on installation.id = job.installation_id
     and installation.brand_id = job.brand_id
    join public.connector_registry provider on provider.id = job.provider_id
    where job.operation = 'refresh' and job.state = 'leased'
      and job.lease_expires_at <= p_now
      and job.lease_rotation_started_at is not null
      and job.lease_rotation_fingerprint is null
      and (provider.provider_key in ('slack', 'tiktok')
        or (provider.provider_key = 'quickbooks-online'
          and coalesce(job.rotation_replay_deadline, job.lease_expires_at) <= p_now))
    order by job.lease_expires_at, job.id
    for update of installation skip locked
    limit p_limit
  ), ambiguous_candidates as (
    select job.id, job.lease_token as expired_lease_token
    from app_private.connector_oauth_lifecycle_jobs job
    join ambiguous_installations installation on installation.id = job.installation_id
    join public.connector_registry provider on provider.id = job.provider_id
    where job.operation = 'refresh' and job.state = 'leased'
      and job.lease_expires_at <= p_now
      and job.lease_rotation_started_at is not null
      and job.lease_rotation_fingerprint is null
      and (provider.provider_key in ('slack', 'tiktok')
        or (provider.provider_key = 'quickbooks-online'
          and coalesce(job.rotation_replay_deadline, job.lease_expires_at) <= p_now))
    order by job.lease_expires_at, job.id
    for update of job skip locked
  ), ambiguous as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = candidate.expired_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = pg_catalog.encode(public.digest(
        jsonb_build_object(
          'errorCode', 'rotation_ambiguous', 'retryable', false
        )::text, 'sha256'
      ), 'hex'),
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_candidates candidate
    where job.id = candidate.id
    returning job.*, candidate.expired_lease_token
  ), degraded as (
    update public.connector_installations installation set
      status = 'reauthorization_required', enabled_capabilities = '{}',
      updated_at = p_now
    from ambiguous
    where installation.id = ambiguous.installation_id
      and installation.brand_id = ambiguous.brand_id
      and installation.credential_reference_id = ambiguous.credential_reference_id
      and installation.status in ('connected_healthy', 'connected_degraded')
    returning installation.id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select ambiguous.brand_id, ambiguous.installation_id,
    'oauth.refresh_failed', 'failure', ambiguous.expired_lease_token,
    'cron', jsonb_build_object(
      'errorCode', 'rotation_ambiguous', 'retryable', false
    )
  from ambiguous;
  with malformed_installations as (
    select installation.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.connector_installations installation
      on installation.id = job.installation_id
     and installation.brand_id = job.brand_id
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    left join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'refresh'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and app.connector_job_credential_valid(
        job.provider_id, 'refresh', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is not true
    order by job.next_attempt_at, job.created_at, job.id
    for update of installation skip locked
    limit p_limit
  ), malformed_candidates as (
    select job.id
    from app_private.connector_oauth_lifecycle_jobs job
    join malformed_installations installation on installation.id = job.installation_id
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    left join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'refresh'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and app.connector_job_credential_valid(
        job.provider_id, 'refresh', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is not true
    for update of job skip locked
  ), quarantined as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'credential_malformed', completed_at = p_now,
      updated_at = p_now
    from malformed_candidates candidate where job.id = candidate.id
    returning job.*
  ), degraded as (
    update public.connector_installations installation set
      status = 'reauthorization_required', enabled_capabilities = '{}',
      updated_at = p_now
    from quarantined
    where installation.id = quarantined.installation_id
      and installation.brand_id = quarantined.brand_id
      and installation.credential_reference_id = quarantined.credential_reference_id
      and installation.status in ('connected_healthy', 'connected_degraded')
    returning installation.id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select quarantined.brand_id, quarantined.installation_id,
    'oauth.refresh_failed', 'failure', gen_random_uuid(), 'cron',
    jsonb_build_object('errorCode', 'credential_malformed', 'retryable', false)
  from quarantined;
  return query
  with candidates as (
    select job.id, provider.provider_key
    from app_private.connector_oauth_lifecycle_jobs job
    join public.connector_installations installation
      on installation.id = job.installation_id
     and installation.brand_id = job.brand_id
     and installation.credential_reference_id = job.credential_reference_id
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'refresh'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and provider.oauth_lifecycle_managed and provider.oauth_refresh_managed
      and ((installation.status in ('connected_healthy', 'connected_degraded')
          and reference.revoked_at is null
          and provider.is_active
          and provider.availability in ('available', 'provider_approval_required'))
        or (provider.provider_key = 'quickbooks-online'
          and job.cancel_requested
          and job.rotation_replay_deadline > p_now))
      and app.connector_job_credential_valid(
        job.provider_id, 'refresh', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is true
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), leased as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'leased', attempt_count = least(job.attempt_count + 1, 50),
      lease_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      lease_rotation_started_at = null,
      lease_rotation_fingerprint = null,
      rotation_replay_deadline = case
        when candidates.provider_key = 'quickbooks-online'
          then coalesce(job.rotation_replay_deadline, p_now + interval '24 hours')
        else null end,
      last_error_code = null, completed_at = null, updated_at = p_now
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select leased.id, leased.brand_id, leased.installation_id,
    leased.credential_reference_id, provider.provider_key,
    leased.credential_generation, leased.lease_token,
    app.try_connector_credential_json(secret.decrypted_secret),
    reference.account_label, reference.expires_at,
    reference.granted_scopes
  from leased
  join public.credential_references reference
    on reference.id = leased.credential_reference_id
   and reference.brand_id = leased.brand_id
  join public.connector_registry provider on provider.id = leased.provider_id
  join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
  order by leased.next_attempt_at, leased.created_at, leased.id;
end $lifecycle$;

create function public.complete_connector_oauth_refresh(
  p_job_id uuid,
  p_lease_token uuid,
  p_credential jsonb,
  p_expires_at timestamptz,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_capabilities_valid boolean;
  v_completion_fingerprint text;
  v_contract_version text;
  v_effective_scopes text[];
  v_account_fingerprint text;
  v_installation public.connector_installations%rowtype;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_provider_available boolean;
  v_provider_id uuid;
  v_reference public.credential_references%rowtype;
  v_stored_credential jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential - 'granted_scopes') > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
    or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    or jsonb_typeof(p_credential->'external_account_id') is distinct from 'string'
    or octet_length(p_credential->>'external_account_id') not between 1 and 512
  then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;
  if p_credential ? 'granted_scopes' then
    if jsonb_typeof(p_credential->'granted_scopes') is distinct from 'array'
      or jsonb_array_length(p_credential->'granted_scopes') > 32
      or exists (
        select 1 from jsonb_array_elements(p_credential->'granted_scopes') item(value)
        where jsonb_typeof(item.value) is distinct from 'string'
          or length(item.value #>> '{}') not between 1 and 512
      ) then
      raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
    end if;
  end if;
  v_stored_credential := p_credential - 'granted_scopes';
  v_completion_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'credential', p_credential,
      'expiresAtEpoch', extract(epoch from p_expires_at)
    )::text, 'sha256'
  ), 'hex');

  select job.installation_id, job.provider_id
  into v_installation_id, v_provider_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;

  select provider.is_active
      and provider.availability in ('available', 'provider_approval_required'),
    provider.adapter_contract_version
  into v_provider_available, v_contract_version
  from public.connector_registry provider
  where provider.id = v_provider_id
  for share;
  if not found then return false; end if;
  perform 1 from public.connector_capabilities capability
  where capability.provider_id = v_provider_id for share;
  perform 1 from public.connector_certifications certification
  join public.connector_capabilities capability
    on capability.id = certification.capability_id
  where capability.provider_id = v_provider_id for share of certification;

  select installation.* into v_installation
  from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;

  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.operation <> 'refresh' or v_job.provider_id <> v_provider_id then
    return false;
  end if;
  if v_job.last_finished_lease_token = p_lease_token then
    return v_job.last_finished_outcome in ('completed', 'compensated')
      and v_job.last_finished_fingerprint = v_completion_fingerprint;
  end if;
  if v_job.state <> 'leased' or v_job.lease_token <> p_lease_token
    or v_job.lease_rotation_started_at is null
    or v_installation.brand_id <> v_job.brand_id
    or (not v_job.cancel_requested
      and v_installation.credential_reference_id <> v_job.credential_reference_id) then
    return false;
  end if;
  if p_expires_at is not null and p_expires_at <= p_now then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;
  if p_expires_at is null or p_expires_at > p_now + interval '30 days' then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_invalid';
  end if;

  select reference.* into v_reference
  from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
  for update;
  if not found
    or v_reference.credential_generation <> v_job.credential_generation
    or (v_reference.revoked_at is not null and not v_job.cancel_requested) then
    return false;
  end if;
  v_account_fingerprint := app.connector_external_account_fingerprint(
    v_job.provider_id, p_credential::text
  );
  if v_reference.external_account_fingerprint is distinct from v_account_fingerprint then
    raise exception using errcode = '22023',
      message = 'connector_oauth_account_mismatch';
  end if;

  if p_credential ? 'granted_scopes' then
    select coalesce(array_agg(distinct item.value order by item.value), '{}')
    into v_effective_scopes
    from jsonb_array_elements_text(p_credential->'granted_scopes') item(value)
    where item.value = any(v_reference.granted_scopes);
  else
    v_effective_scopes := v_reference.granted_scopes;
  end if;

  perform vault.update_secret(
    v_reference.vault_secret_id, v_stored_credential::text, null::text, null::text
  );
  update public.credential_references reference set
    granted_scopes = v_effective_scopes,
    expires_at = p_expires_at,
    last_rotated_at = p_now,
    credential_generation = reference.credential_generation + 1,
    updated_at = p_now
  where reference.id = v_reference.id
    and reference.brand_id = v_reference.brand_id
    and reference.credential_generation = v_job.credential_generation;
  if not found then return false; end if;

  if v_job.cancel_requested or v_installation.status = 'revoked'
    or v_installation.status = 'disabled'
    or not coalesce(v_provider_available, false) then
    update public.credential_references reference set
      revoked_at = coalesce(reference.revoked_at, p_now), updated_at = p_now
    where reference.id = v_job.credential_reference_id
      and reference.brand_id = v_job.brand_id;
    update public.connector_installations installation set
      status = 'disabled', enabled_capabilities = '{}', updated_at = p_now
    where installation.id = v_job.installation_id
      and installation.brand_id = v_job.brand_id
      and installation.credential_reference_id = v_job.credential_reference_id
      and (v_installation.status = 'disabled'
        or not coalesce(v_provider_available, false));
    update app_private.connector_oauth_lifecycle_jobs revoke_job set
      credential_generation = v_job.credential_generation + 1,
      state = 'pending', next_attempt_at = p_now,
      attempt_count = 0,
      lease_token = null, lease_expires_at = null,
      lease_rotation_started_at = null,
      lease_rotation_fingerprint = null,
      last_finished_lease_token = null,
      last_finished_outcome = null,
      last_finished_fingerprint = null,
      last_error_code = null, completed_at = null, updated_at = p_now
    where revoke_job.credential_reference_id = v_job.credential_reference_id
      and revoke_job.operation = 'revoke'
      and revoke_job.state not in ('leased', 'succeeded');
    if not found then
      insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, credential_generation, next_attempt_at
      ) values (
        v_job.brand_id, v_job.installation_id, v_job.credential_reference_id,
        v_job.provider_id, 'revoke', v_job.credential_generation + 1, p_now
      ) on conflict (credential_reference_id, operation) do nothing;
    end if;
    update app_private.connector_oauth_lifecycle_jobs refresh_job set
      state = 'cancelled', attempt_count = 0,
      lease_token = null, lease_expires_at = null,
      lease_rotation_started_at = null,
      last_finished_lease_token = p_lease_token,
      last_finished_outcome = 'compensated',
      last_finished_fingerprint = v_completion_fingerprint,
      last_error_code = null, completed_at = p_now, updated_at = p_now
    where refresh_job.id = v_job.id;
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    ) values (
      v_job.brand_id, v_job.installation_id, 'oauth.refresh_compensated',
      'success', p_lease_token, 'cron', jsonb_build_object(
        'credentialGeneration', v_job.credential_generation + 1,
        'revocationQueued', true,
        'providerAvailable', coalesce(v_provider_available, false)
      )
    );
    return true;
  end if;

  select cardinality(v_installation.enabled_capabilities) > 0
      and case when jsonb_typeof(
        v_installation.settings->'oauthRequestedScopes'
      ) = 'array' then
        (v_installation.settings->'oauthRequestedScopes')
          <@ to_jsonb(v_effective_scopes)
      else false end
      and not exists (
        select 1
        from unnest(v_installation.enabled_capabilities) enabled(capability_key)
        where not exists (
          select 1 from public.connector_capabilities capability
          join public.connector_certifications certification
            on certification.capability_id = capability.id
          where capability.provider_id = v_installation.provider_id
            and capability.capability_key = enabled.capability_key
            and capability.is_active
            and (cardinality(capability.oauth_scopes) = 0
              or (capability.oauth_scopes <@ v_effective_scopes
                and case when jsonb_typeof(
                  v_installation.settings->'oauthRequestedScopes'
                ) = 'array' then capability.oauth_scopes <@ array(
                  select jsonb_array_elements_text(
                    v_installation.settings->'oauthRequestedScopes'
                  )
                ) else false end))
            and certification.environment = 'sandbox'
            and certification.status = 'passed'
            and certification.contract_version = v_contract_version
            and certification.certified_at is not null
            and (certification.valid_until is null
              or certification.valid_until > p_now)
        )
      ) into v_capabilities_valid
  ;

  update public.connector_installations installation set
    status = case when coalesce(v_capabilities_valid, false)
      then 'connected_healthy' else 'reauthorization_required' end,
    enabled_capabilities = case when coalesce(v_capabilities_valid, false)
      then installation.enabled_capabilities else '{}' end,
    updated_at = p_now
  where installation.id = v_installation.id
    and installation.brand_id = v_installation.brand_id;
  update app_private.connector_oauth_lifecycle_jobs job set
    state = case when coalesce(v_capabilities_valid, false)
      then 'pending' else 'permanent_failure' end,
    credential_generation = job.credential_generation + 1,
    attempt_count = 0,
    next_attempt_at = greatest(
      p_now + interval '1 minute', p_expires_at - interval '10 minutes'
    ),
    lease_token = null, lease_expires_at = null,
    lease_rotation_started_at = null,
    rotation_replay_deadline = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'completed',
    last_finished_fingerprint = v_completion_fingerprint,
    last_error_code = case when coalesce(v_capabilities_valid, false)
      then null else 'scope_or_capability_invalid' end,
    completed_at = case when coalesce(v_capabilities_valid, false)
      then null else p_now end,
    updated_at = p_now
  where job.id = v_job.id;
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.refresh_completed',
    'success', p_lease_token, 'cron', jsonb_build_object(
      'previousGeneration', v_job.credential_generation,
      'credentialGeneration', v_job.credential_generation + 1,
      'scopeContractValid', coalesce(v_capabilities_valid, false)
    )
  );
  return true;
end $lifecycle$;

create function public.fail_connector_oauth_refresh(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_failure_fingerprint text;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_permanent boolean;
  v_provider_key text;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_retryable is null or p_error_code is null
    or p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'connector_oauth_failure_invalid';
  end if;
  v_failure_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'errorCode', p_error_code, 'retryable', p_retryable
    )::text, 'sha256'
  ), 'hex');
  select job.installation_id into v_installation_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;

  select job.* into v_job
  from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  if v_job.operation <> 'refresh' then return false; end if;
  if v_job.last_finished_lease_token = p_lease_token then
    return v_job.last_finished_outcome = 'failed'
      and v_job.last_finished_fingerprint = v_failure_fingerprint;
  end if;
  if v_job.state <> 'leased' or v_job.lease_token <> p_lease_token then
    return false;
  end if;

  select provider.provider_key into v_provider_key
  from public.connector_registry provider where provider.id = v_job.provider_id;
  if p_retryable and v_job.lease_rotation_started_at is not null
    and v_job.lease_rotation_fingerprint is null
    and v_provider_key in ('slack', 'tiktok') then
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = p_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = v_failure_fingerprint,
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    where job.id = v_job.id;
    if v_job.cancel_requested then
      update app_private.connector_oauth_lifecycle_jobs revoke_job set
        state = 'permanent_failure', last_error_code = 'rotation_ambiguous',
        completed_at = p_now, updated_at = p_now
      where revoke_job.credential_reference_id = v_job.credential_reference_id
        and revoke_job.operation = 'revoke'
        and revoke_job.state not in ('leased', 'succeeded');
    end if;
    update public.connector_installations installation set
      status = 'reauthorization_required', enabled_capabilities = '{}',
      updated_at = p_now
    where installation.id = v_job.installation_id
      and installation.brand_id = v_job.brand_id
      and installation.credential_reference_id = v_job.credential_reference_id
      and installation.status in ('connected_healthy', 'connected_degraded');
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    ) values (v_job.brand_id, v_job.installation_id, 'oauth.refresh_failed',
      'failure', p_lease_token, 'cron', jsonb_build_object(
        'errorCode', 'rotation_ambiguous', 'retryable', false,
        'attempt', v_job.attempt_count));
    return true;
  end if;

  if v_job.cancel_requested then
    if v_provider_key = 'quickbooks-online' and p_retryable
      and v_job.rotation_replay_deadline > p_now then
      update app_private.connector_oauth_lifecycle_jobs job set
        state = 'pending',
        next_attempt_at = p_now + make_interval(secs => least(
          21600, (60 * power(2, least(job.attempt_count - 1, 8)))::integer
        )),
        lease_token = null, lease_expires_at = null,
        lease_rotation_started_at = null,
        lease_rotation_fingerprint = null,
        last_finished_lease_token = p_lease_token,
        last_finished_outcome = 'failed',
        last_finished_fingerprint = v_failure_fingerprint,
        last_error_code = p_error_code, completed_at = null, updated_at = p_now
      where job.id = v_job.id;
      return true;
    end if;
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'cancelled', attempt_count = 0,
      lease_token = null, lease_expires_at = null,
      lease_rotation_started_at = null,
      rotation_replay_deadline = null,
      last_finished_lease_token = p_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = v_failure_fingerprint,
      last_error_code = p_error_code, completed_at = p_now, updated_at = p_now
    where job.id = v_job.id;
    return true;
  end if;

  v_permanent := not p_retryable;
  update app_private.connector_oauth_lifecycle_jobs job set
    state = case when v_permanent then 'permanent_failure' else 'pending' end,
    next_attempt_at = case when v_permanent then job.next_attempt_at else
      p_now + make_interval(secs => least(
        21600, (60 * power(2, least(job.attempt_count - 1, 8)))::integer
      )) end,
    lease_token = null, lease_expires_at = null,
    lease_rotation_started_at = null,
    rotation_replay_deadline = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'failed',
    last_finished_fingerprint = v_failure_fingerprint,
    last_error_code = p_error_code,
    completed_at = case when v_permanent then p_now else null end,
    updated_at = p_now
  where job.id = v_job.id;
  update public.connector_installations installation set
    status = case when v_permanent
      then 'reauthorization_required' else 'connected_degraded' end,
    enabled_capabilities = case when v_permanent
      then '{}' else installation.enabled_capabilities end,
    updated_at = p_now
  where installation.id = v_job.installation_id
    and installation.brand_id = v_job.brand_id
    and installation.credential_reference_id = v_job.credential_reference_id
    and installation.status in ('connected_healthy', 'connected_degraded');
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (
    v_job.brand_id, v_job.installation_id, 'oauth.refresh_failed',
    'failure', p_lease_token, 'cron', jsonb_build_object(
      'errorCode', p_error_code, 'retryable', not v_permanent,
      'attempt', v_job.attempt_count
    )
  );
  return true;
end $lifecycle$;

create function public.quarantine_connector_oauth_rotation_result(
  p_job_id uuid,
  p_lease_token uuid,
  p_credential jsonb,
  p_expires_at timestamptz,
  p_reason text,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $lifecycle$
declare
  v_external_account_id text;
  v_fingerprint text;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_namespace text;
  v_old_credential jsonb;
  v_provider_key text;
  v_provider_id uuid;
  v_reference public.credential_references%rowtype;
  v_stored_credential jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,63}$'
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential) > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or (p_credential ? 'refresh_token' and (
      jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
      or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    )) or (p_credential ? 'external_account_id' and (
      jsonb_typeof(p_credential->'external_account_id') is distinct from 'string'
      or octet_length(p_credential->>'external_account_id') not between 1 and 512
    )) or (p_expires_at is not null and p_expires_at <= p_now) then
    raise exception using errcode = '22023', message = 'connector_oauth_quarantine_invalid';
  end if;
  select job.installation_id, job.provider_id into v_installation_id, v_provider_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  select provider.oauth_grant_namespace, provider.provider_key
  into v_namespace, v_provider_key
  from public.connector_registry provider
  where provider.id = v_provider_id and provider.oauth_lifecycle_managed
    and (provider.oauth_refresh_managed
      or provider.provider_key = 'meta-business-suite') for share;
  if not found then return false; end if;
  if p_expires_at is not null and p_expires_at > p_now +
      case when v_provider_key = 'meta-business-suite'
        then interval '90 days' else interval '30 days' end then
    raise exception using errcode = '22023', message = 'connector_oauth_quarantine_invalid';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_namespace for update;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;
  select job.* into v_job from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  v_fingerprint := pg_catalog.encode(public.digest(jsonb_build_object(
    'credential', p_credential - 'granted_scopes',
    'expiresAt', to_jsonb(p_expires_at), 'reason', p_reason
  )::text, 'sha256'), 'hex');
  if v_job.last_finished_lease_token = p_lease_token then
    return v_job.last_finished_outcome = 'compensated'
      and v_job.last_finished_fingerprint = v_fingerprint;
  end if;
  if v_job.operation not in ('identify', 'refresh', 'revoke')
    or v_job.state <> 'leased'
    or v_job.lease_token <> p_lease_token
    or v_job.lease_rotation_started_at is null then return false; end if;
  if v_job.operation = 'refresh' then
    perform 1 from app_private.connector_oauth_lifecycle_jobs revoke_job
    where revoke_job.credential_reference_id = v_job.credential_reference_id
      and revoke_job.operation = 'revoke' for update;
    if exists (select 1 from app_private.connector_oauth_lifecycle_jobs revoke_job
      where revoke_job.credential_reference_id = v_job.credential_reference_id
        and revoke_job.operation = 'revoke' and revoke_job.state = 'leased') then
      return false;
    end if;
  end if;
  select reference.* into v_reference from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
    and reference.credential_generation = v_job.credential_generation for update;
  if not found then return false; end if;
  select app.try_connector_credential_json(secret.decrypted_secret)
  into v_old_credential from vault.decrypted_secrets secret
  where secret.id = v_reference.vault_secret_id;
  if (v_job.operation = 'identify'
      and app.connector_identity_credential_valid(v_old_credential::text) is not true)
    or (v_job.operation <> 'identify' and app.connector_job_credential_valid(
      v_job.provider_id, v_job.operation, v_old_credential::text,
      v_reference.external_account_fingerprint
    ) is not true) then return false; end if;
  if jsonb_typeof(v_old_credential->'external_account_id') = 'string' then
    v_external_account_id := v_old_credential->>'external_account_id';
  end if;
  v_stored_credential := p_credential - 'granted_scopes' - 'external_account_id';
  if v_external_account_id is not null then
    v_stored_credential := jsonb_set(
      v_stored_credential, '{external_account_id}',
      to_jsonb(v_external_account_id), true
    );
  end if;
  if pg_column_size(v_stored_credential) > 24576 then
    raise exception using errcode = '22023', message = 'connector_oauth_quarantine_invalid';
  end if;
  perform vault.update_secret(
    v_reference.vault_secret_id, v_stored_credential::text, null::text, null::text
  );
  update public.credential_references reference set
    expires_at = p_expires_at, revoked_at = coalesce(reference.revoked_at, p_now),
    last_rotated_at = p_now,
    credential_generation = reference.credential_generation + 1, updated_at = p_now
  where reference.id = v_reference.id
    and reference.credential_generation = v_job.credential_generation;
  if not found then return false; end if;
  if v_job.operation = 'refresh' then
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) values (v_job.brand_id, v_job.installation_id, v_job.credential_reference_id,
      v_job.provider_id, 'revoke', v_job.credential_generation + 1, p_now)
    on conflict (credential_reference_id, operation) do update set
      state = 'pending', credential_generation = excluded.credential_generation,
      attempt_count = 0, next_attempt_at = p_now,
      lease_token = null, lease_expires_at = null,
      lease_rotation_started_at = null, lease_rotation_fingerprint = null,
      rotation_replay_deadline = null,
      last_finished_lease_token = null, last_finished_outcome = null,
      last_finished_fingerprint = null, cancel_requested = false,
      last_error_code = null, completed_at = null, updated_at = p_now;
  end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    state = case when job.operation = 'refresh'
      then 'permanent_failure' else 'pending' end,
    credential_generation = job.credential_generation + 1,
    attempt_count = case when job.operation = 'refresh'
      then job.attempt_count else 0 end,
    next_attempt_at = case when job.operation = 'refresh'
      then job.next_attempt_at else p_now end,
    lease_token = null, lease_expires_at = null,
    lease_rotation_started_at = null, lease_rotation_fingerprint = null,
    rotation_replay_deadline = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'compensated',
    last_finished_fingerprint = v_fingerprint,
    cancel_requested = false,
    last_error_code = p_reason,
    completed_at = case when job.operation = 'refresh' then p_now else null end,
    updated_at = p_now
  where job.id = v_job.id;
  update public.connector_installations installation set
    status = 'reauthorization_required', enabled_capabilities = '{}', updated_at = p_now
  where installation.id = v_job.installation_id
    and installation.brand_id = v_job.brand_id
    and installation.credential_reference_id = v_job.credential_reference_id
    and v_job.operation = 'refresh';
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (v_job.brand_id, v_job.installation_id,
    'oauth.rotation_quarantined', 'failure', p_lease_token, 'cron',
    jsonb_build_object('operation', v_job.operation, 'reason', p_reason,
      'credentialGeneration', v_job.credential_generation + 1,
      'revocationQueued', v_job.operation = 'refresh'));
  return true;
end $lifecycle$;

revoke all on function public.reconcile_connector_credential_status(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_connector_credential_status(timestamptz, integer)
  to service_role;
revoke all on function public.disconnect_connector_oauth_connection(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.disconnect_connector_oauth_connection(uuid, text, uuid)
  to service_role;
revoke all on function public.start_connector_oauth_credential_rotation(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.start_connector_oauth_credential_rotation(
  uuid, uuid, timestamptz
) to service_role;
revoke all on function public.cancel_connector_oauth_credential_rotation(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.cancel_connector_oauth_credential_rotation(
  uuid, uuid, timestamptz
) to service_role;
revoke all on function public.claim_connector_oauth_identities(
  timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_connector_oauth_identities(
  timestamptz, integer, integer
) to service_role;
revoke all on function public.rotate_connector_oauth_identity_credential(
  uuid, uuid, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.rotate_connector_oauth_identity_credential(
  uuid, uuid, jsonb, timestamptz, timestamptz
) to service_role;
revoke all on function public.complete_connector_oauth_identity(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_connector_oauth_identity(
  uuid, uuid, text, timestamptz
) to service_role;
revoke all on function public.fail_connector_oauth_identity(
  uuid, uuid, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_connector_oauth_identity(
  uuid, uuid, text, boolean, timestamptz
) to service_role;
revoke all on function public.claim_connector_oauth_revocations(
  timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_connector_oauth_revocations(
  timestamptz, integer, integer
) to service_role;
revoke all on function public.rotate_connector_oauth_revocation_credential(
  uuid, uuid, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.rotate_connector_oauth_revocation_credential(
  uuid, uuid, jsonb, timestamptz, timestamptz
) to service_role;
revoke all on function public.complete_connector_oauth_revocation(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_connector_oauth_revocation(
  uuid, uuid, timestamptz
) to service_role;
revoke all on function public.fail_connector_oauth_revocation(
  uuid, uuid, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_connector_oauth_revocation(
  uuid, uuid, text, boolean, timestamptz
) to service_role;
revoke all on function public.claim_connector_oauth_refreshes(
  timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_connector_oauth_refreshes(
  timestamptz, integer, integer
) to service_role;
revoke all on function public.complete_connector_oauth_refresh(
  uuid, uuid, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_connector_oauth_refresh(
  uuid, uuid, jsonb, timestamptz, timestamptz
) to service_role;
revoke all on function public.fail_connector_oauth_refresh(
  uuid, uuid, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_connector_oauth_refresh(
  uuid, uuid, text, boolean, timestamptz
) to service_role;

create or replace function app.assert_connector_oauth_runtime()
returns void language plpgsql stable security invoker set search_path = '' as $lifecycle$
declare
  v_signature text;
begin
  if pg_catalog.to_regprocedure(
      'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)'
    ) is not null then
    raise exception 'non-idempotent connector OAuth completion remains';
  end if;
  if pg_catalog.to_regprocedure(
      'public.consume_connector_oauth_state(text,uuid,text)'
    ) is not null then
    raise exception 'non-idempotent connector OAuth state consumer remains';
  end if;
  foreach v_signature in array array[
    'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)',
    'public.consume_connector_oauth_state(text,uuid,text,text,uuid)',
    'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
    'public.cancel_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
    'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,uuid,jsonb,text,text[],timestamptz)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'connector OAuth runtime RPC is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'connector OAuth runtime is client reachable: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'connector OAuth runtime is unavailable: %', v_signature;
    end if;
  end loop;
  if pg_catalog.to_regclass(
    'app_private.connector_oauth_states_active_actor_idx'
  ) is null then
    raise exception 'connector OAuth active-state index is missing';
  end if;
end $lifecycle$;
revoke all on function app.assert_connector_oauth_runtime()
  from public, anon, authenticated;
grant execute on function app.assert_connector_oauth_runtime() to service_role;

create or replace function app.assert_connector_credential_lifecycle()
returns void language plpgsql stable security invoker set search_path = '' as $lifecycle$
declare
  v_signature text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'square_connections'
      and column_name = 'oauth_scope_contract_version'
      and is_nullable = 'NO' and column_default = '1'
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
end $lifecycle$;
revoke all on function app.assert_connector_credential_lifecycle()
  from public, anon, authenticated;
grant execute on function app.assert_connector_credential_lifecycle() to service_role;

select app.register_release(
  '20260908228000',
  'connector credential lifecycle and Square OAuth scope contract',
  'app.assert_connector_credential_lifecycle()'::regprocedure
);
