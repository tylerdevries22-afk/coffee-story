-- Hosted platform-factory control plane.
--
-- These records orchestrate industry and tenant creation. They never contain
-- provider credentials: infrastructure secrets live in Doppler and runtime
-- connector secrets live in Vault. Client roles receive read access only to
-- the explicitly listed platform-admin views of state below.

create table public.industry_blueprints (
  id uuid primary key default gen_random_uuid(),
  industry_key text not null,
  version integer not null check (version > 0),
  name text not null check (length(btrim(name)) between 2 and 120),
  locale text not null default 'en-US',
  supabase_region text not null default 'us-west-1',
  manifest jsonb not null check (
    jsonb_typeof(manifest) = 'object'
    and pg_column_size(manifest) <= 262144
  ),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (industry_key, version),
  check (industry_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table public.platform_onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  industry_blueprint_id uuid not null references public.industry_blueprints (id),
  business_name text not null check (length(btrim(business_name)) between 2 and 120),
  tenant_slug text not null check (tenant_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  location_name text not null check (length(btrim(location_name)) between 2 and 120),
  timezone text not null check (length(timezone) between 3 and 64),
  website_url text check (website_url is null or website_url ~ '^https://'),
  state text not null default 'draft'
    check (state in ('draft', 'running', 'blocked', 'failed', 'live', 'rolled_back')),
  stage text not null default 'intake'
    check (stage in ('intake', 'demo', 'credentials', 'infrastructure', 'content', 'canary', 'live')),
  schema_version integer not null default 1 check (schema_version > 0),
  idempotency_key uuid not null unique,
  automation_policy_version integer not null default 1 check (automation_policy_version > 0),
  last_error_code text,
  created_by uuid not null references auth.users (id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug)
);

create table public.platform_onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.platform_onboarding_runs (id) on delete cascade,
  task_key text not null check (task_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null check (length(btrim(label)) between 2 and 160),
  stage text not null check (stage in ('intake', 'demo', 'credentials', 'infrastructure', 'content', 'canary', 'live')),
  provider text not null check (provider in ('platform', 'research', 'github', 'doppler', 'supabase', 'vercel', 'expo', 'apple', 'google-play', 'elevate')),
  state text not null default 'pending'
    check (state in ('pending', 'running', 'blocked', 'completed', 'failed', 'rolled_back')),
  dependency_keys text[] not null default '{}',
  credential_keys text[] not null default '{}',
  timeout_ms integer not null check (timeout_ms between 1000 and 300000),
  maximum_attempts integer not null check (maximum_attempts between 1 and 5),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  last_error_code text,
  correlation_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, task_key)
);

create table public.platform_credential_requirements (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.platform_onboarding_runs (id) on delete cascade,
  provider text not null,
  credential_key text not null check (credential_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  owner_role text not null check (owner_role in ('platform', 'client', 'account_holder')),
  storage_system text not null check (storage_system in ('doppler', 'supabase_vault', 'provider_managed')),
  state text not null default 'required'
    check (state in ('required', 'connecting', 'verified', 'rejected', 'expired')),
  secret_reference text,
  fingerprint text,
  scopes text[] not null default '{}',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, credential_key),
  check (secret_reference is null or length(secret_reference) <= 256),
  check (fingerprint is null or length(fingerprint) <= 128)
);

create table public.platform_provisioned_resources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.platform_onboarding_runs (id) on delete cascade,
  provider text not null,
  resource_kind text not null,
  environment text not null check (environment in ('development', 'preview', 'production')),
  external_id text not null check (length(external_id) between 1 and 256),
  display_name text not null,
  state text not null default 'provisioning'
    check (state in ('provisioning', 'ready', 'degraded', 'failed', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, resource_kind, environment, external_id)
);

create table public.platform_artifact_manifests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.platform_onboarding_runs (id) on delete cascade,
  artifact_kind text not null check (artifact_kind in ('brand_kit', 'catalog', 'training', 'media', 'application', 'deployment')),
  version integer not null check (version > 0),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and pg_column_size(manifest) <= 1048576),
  source_fingerprint text not null,
  validation_state text not null check (validation_state in ('pending', 'valid', 'invalid')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, artifact_kind, version)
);

create table public.platform_automation_policies (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.platform_onboarding_runs (id) on delete cascade,
  version integer not null check (version > 0),
  policy jsonb not null check (jsonb_typeof(policy) = 'object' and pg_column_size(policy) <= 65536),
  status text not null default 'active' check (status in ('active', 'superseded', 'revoked')),
  authorized_by uuid not null references auth.users (id),
  authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, version)
);

create table public.platform_rate_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null,
  version text not null,
  terms jsonb not null check (jsonb_typeof(terms) = 'object' and pg_column_size(terms) <= 32768),
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (plan_key, version)
);

create table public.platform_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.platform_onboarding_runs (id),
  elevate_client_id text unique,
  stripe_customer_reference text,
  rate_plan_id uuid references public.platform_rate_plans (id),
  state text not null default 'pending'
    check (state in ('pending', 'trial', 'active', 'past_due', 'restricted', 'cancelled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_billing_entitlement_snapshots (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references public.platform_billing_accounts (id),
  external_event_id text not null unique,
  event_type text not null,
  entitlements jsonb not null check (jsonb_typeof(entitlements) = 'object' and pg_column_size(entitlements) <= 32768),
  effective_at timestamptz not null,
  signature_fingerprint text not null,
  created_at timestamptz not null default now()
);

create table public.platform_billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144),
  signature_fingerprint text not null,
  state text not null default 'received' check (state in ('received', 'processed', 'rejected', 'dead_letter')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.platform_provider_guides (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  guide_key text not null,
  version integer not null check (version > 0),
  title text not null,
  owner_role text not null check (owner_role in ('platform', 'client', 'account_holder')),
  official_url text not null check (official_url ~ '^https://'),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) > 0 and pg_column_size(steps) <= 131072),
  last_verified_at timestamptz not null,
  status text not null default 'active' check (status in ('draft', 'active', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, guide_key, version)
);

create table public.platform_factory_audit_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.platform_onboarding_runs (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768),
  created_at timestamptz not null default now()
);

create index platform_onboarding_runs_state_idx on public.platform_onboarding_runs (state, updated_at desc);
create index platform_onboarding_tasks_run_state_idx on public.platform_onboarding_tasks (run_id, state, stage);
create index platform_credentials_run_state_idx on public.platform_credential_requirements (run_id, state);
create index platform_resources_run_state_idx on public.platform_provisioned_resources (run_id, state);
create index platform_artifacts_run_kind_idx on public.platform_artifact_manifests (run_id, artifact_kind, version desc);
create index platform_billing_snapshots_account_idx on public.platform_billing_entitlement_snapshots (billing_account_id, effective_at desc);
create index platform_audit_run_created_idx on public.platform_factory_audit_events (run_id, created_at desc);
create unique index platform_audit_event_correlation_uidx
on public.platform_factory_audit_events (event_type, correlation_id);

create trigger industry_blueprints_touch before update on public.industry_blueprints
for each row execute function app.touch_updated_at();
create trigger platform_onboarding_runs_touch before update on public.platform_onboarding_runs
for each row execute function app.touch_updated_at();
create trigger platform_onboarding_tasks_touch before update on public.platform_onboarding_tasks
for each row execute function app.touch_updated_at();
create trigger platform_credentials_touch before update on public.platform_credential_requirements
for each row execute function app.touch_updated_at();
create trigger platform_resources_touch before update on public.platform_provisioned_resources
for each row execute function app.touch_updated_at();
create trigger platform_billing_accounts_touch before update on public.platform_billing_accounts
for each row execute function app.touch_updated_at();
create trigger platform_provider_guides_touch before update on public.platform_provider_guides
for each row execute function app.touch_updated_at();

create trigger platform_entitlements_immutable
before update or delete on public.platform_billing_entitlement_snapshots
for each row execute function app.reject_record_mutation();
create trigger platform_audit_immutable
before update or delete on public.platform_factory_audit_events
for each row execute function app.reject_record_mutation();

alter table public.industry_blueprints enable row level security;
alter table public.platform_onboarding_runs enable row level security;
alter table public.platform_onboarding_tasks enable row level security;
alter table public.platform_credential_requirements enable row level security;
alter table public.platform_provisioned_resources enable row level security;
alter table public.platform_artifact_manifests enable row level security;
alter table public.platform_automation_policies enable row level security;
alter table public.platform_rate_plans enable row level security;
alter table public.platform_billing_accounts enable row level security;
alter table public.platform_billing_entitlement_snapshots enable row level security;
alter table public.platform_billing_webhook_events enable row level security;
alter table public.platform_provider_guides enable row level security;
alter table public.platform_factory_audit_events enable row level security;

create policy industry_blueprints_platform_read on public.industry_blueprints
for select to authenticated using (app.is_platform_admin());
create policy platform_onboarding_runs_platform_read on public.platform_onboarding_runs
for select to authenticated using (app.is_platform_admin());
create policy platform_onboarding_tasks_platform_read on public.platform_onboarding_tasks
for select to authenticated using (app.is_platform_admin());
create policy platform_credentials_platform_read on public.platform_credential_requirements
for select to authenticated using (app.is_platform_admin());
create policy platform_resources_platform_read on public.platform_provisioned_resources
for select to authenticated using (app.is_platform_admin());
create policy platform_artifacts_platform_read on public.platform_artifact_manifests
for select to authenticated using (app.is_platform_admin());
create policy platform_automation_policies_platform_read on public.platform_automation_policies
for select to authenticated using (app.is_platform_admin());
create policy platform_rate_plans_platform_read on public.platform_rate_plans
for select to authenticated using (app.is_platform_admin());
create policy platform_billing_accounts_platform_read on public.platform_billing_accounts
for select to authenticated using (app.is_platform_admin());
create policy platform_entitlements_platform_read on public.platform_billing_entitlement_snapshots
for select to authenticated using (app.is_platform_admin());
create policy platform_provider_guides_platform_read on public.platform_provider_guides
for select to authenticated using (app.is_platform_admin());

revoke all on
  public.industry_blueprints,
  public.platform_onboarding_runs,
  public.platform_onboarding_tasks,
  public.platform_credential_requirements,
  public.platform_provisioned_resources,
  public.platform_artifact_manifests,
  public.platform_automation_policies,
  public.platform_rate_plans,
  public.platform_billing_accounts,
  public.platform_billing_entitlement_snapshots,
  public.platform_billing_webhook_events,
  public.platform_provider_guides,
  public.platform_factory_audit_events
from public, anon, authenticated;

grant select on
  public.industry_blueprints,
  public.platform_onboarding_runs,
  public.platform_onboarding_tasks,
  public.platform_credential_requirements,
  public.platform_provisioned_resources,
  public.platform_artifact_manifests,
  public.platform_automation_policies,
  public.platform_rate_plans,
  public.platform_billing_accounts,
  public.platform_billing_entitlement_snapshots,
  public.platform_provider_guides
to authenticated;

grant all on
  public.industry_blueprints,
  public.platform_onboarding_runs,
  public.platform_onboarding_tasks,
  public.platform_credential_requirements,
  public.platform_provisioned_resources,
  public.platform_artifact_manifests,
  public.platform_automation_policies,
  public.platform_rate_plans,
  public.platform_billing_accounts,
  public.platform_billing_entitlement_snapshots,
  public.platform_billing_webhook_events,
  public.platform_provider_guides,
  public.platform_factory_audit_events
to service_role;

insert into public.industry_blueprints (
  industry_key, version, name, locale, supabase_region, manifest, status
)
values (
  'coffee-shop', 1, 'Coffee shop', 'en-US', 'us-west-1',
  jsonb_build_object(
    'schemaVersion', 1,
    'key', 'coffee-shop',
    'name', 'Coffee shop',
    'templateVersion', 1,
    'locale', 'en-US',
    'supabaseRegion', 'us-west-1',
    'vocabulary', jsonb_build_object(
      'catalog', 'Catalog',
      'folder', 'Category',
      'offering', 'Menu item',
      'resource', 'Recipe'
    )
  ),
  'active'
)
on conflict (industry_key, version) do update set
  name = excluded.name,
  locale = excluded.locale,
  supabase_region = excluded.supabase_region,
  manifest = excluded.manifest,
  status = excluded.status,
  updated_at = now();

insert into public.platform_rate_plans (plan_key, version, terms, status, effective_at)
values (
  'independent-shop-app',
  '2026-08-26',
  jsonb_build_object(
    'trial', jsonb_build_object('days', 30, 'setupCents', 0, 'platformMonthlyCents', 0, 'feeBps', 200),
    'payInFull', jsonb_build_object('setupCents', 550000, 'platformMonthlyCents', 24900),
    'finance', jsonb_build_object('installmentCents', 60000, 'installments', 12, 'platformMonthlyCents', 24900),
    'commission', jsonb_build_object('feeBps', 200, 'feeBpsTier2', 150, 'tierThresholdCents', 2500000, 'scope', 'location_calendar_month', 'method', 'marginal'),
    'additionalLocation', jsonb_build_object('setupCents', 250000, 'platformMonthlyCents', 29900),
    'day90Guarantee', jsonb_build_object('minimumAppRevenueShare', 0.10, 'creditPaidSetup', true, 'cancelRemainingInstallments', true)
  ),
  'active',
  '2026-08-26T00:00:00Z'
)
on conflict (plan_key, version) do update set
  terms = excluded.terms,
  status = excluded.status,
  effective_at = excluded.effective_at;

comment on table public.platform_credential_requirements is
  'Secret metadata only. secret_reference points to Doppler, Vault, or the provider; secret values are forbidden.';
comment on table public.platform_billing_webhook_events is
  'Server-only signed Elevate webhook inbox. No client role receives table privileges.';

create or replace function public.create_platform_onboarding_run(
  input_blueprint_id uuid,
  input_business_name text,
  input_tenant_slug text,
  input_location_name text,
  input_timezone text,
  input_website_url text,
  input_idempotency_key uuid,
  input_created_by uuid,
  input_tasks jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run uuid;
  task_entry jsonb;
  credential_requirement_key text;
begin
  if jsonb_typeof(input_tasks) is distinct from 'array'
     or jsonb_array_length(input_tasks) < 1
     or jsonb_array_length(input_tasks) > 32 then
    raise exception using errcode = '22023', message = 'invalid_factory_tasks';
  end if;

  select run.id into target_run
  from public.platform_onboarding_runs run
  where run.idempotency_key = input_idempotency_key
     or run.tenant_slug = input_tenant_slug
  order by (run.idempotency_key = input_idempotency_key) desc
  limit 1;

  if target_run is null then
    insert into public.platform_onboarding_runs (
      industry_blueprint_id, business_name, tenant_slug, location_name,
      timezone, website_url, state, stage, idempotency_key, created_by
    ) values (
      input_blueprint_id, btrim(input_business_name), input_tenant_slug,
      btrim(input_location_name), input_timezone, nullif(btrim(input_website_url), ''),
      'running', 'intake', input_idempotency_key, input_created_by
    ) returning id into target_run;
  elsif not exists (
    select 1 from public.platform_onboarding_runs run
    where run.id = target_run
      and run.industry_blueprint_id = input_blueprint_id
      and run.business_name = btrim(input_business_name)
  ) then
    raise exception using errcode = '23505', message = 'tenant_slug_already_in_use';
  end if;

  for task_entry in select value from jsonb_array_elements(input_tasks)
  loop
    insert into public.platform_onboarding_tasks (
      run_id, task_key, label, stage, provider, state, dependency_keys,
      credential_keys, timeout_ms, maximum_attempts
    ) values (
      target_run,
      task_entry->>'key',
      task_entry->>'label',
      task_entry->>'stage',
      task_entry->>'provider',
      case when task_entry->>'key' = 'research-brand' then 'running' else 'pending' end,
      array(select jsonb_array_elements_text(coalesce(task_entry->'dependsOn', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(task_entry->'credentialKeys', '[]'::jsonb))),
      (task_entry->>'timeoutMs')::integer,
      (task_entry->>'maximumAttempts')::integer
    ) on conflict (run_id, task_key) do nothing;

    for credential_requirement_key in
      select jsonb_array_elements_text(coalesce(task_entry->'credentialKeys', '[]'::jsonb))
    loop
      insert into public.platform_credential_requirements (
        run_id, provider, credential_key, owner_role, storage_system
      ) values (
        target_run,
        task_entry->>'provider',
        credential_requirement_key,
        'platform',
        'doppler'
      ) on conflict (run_id, credential_key) do nothing;
    end loop;
  end loop;

  insert into public.platform_factory_audit_events (
    run_id, actor_id, event_type, correlation_id, metadata
  ) values (
    target_run, input_created_by, 'onboarding.run_created', input_idempotency_key,
    jsonb_build_object('tenantSlug', input_tenant_slug, 'schemaVersion', 1)
  ) on conflict (event_type, correlation_id) do nothing;

  return target_run;
end $$;

revoke all on function public.create_platform_onboarding_run(
  uuid, text, text, text, text, text, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.create_platform_onboarding_run(
  uuid, text, text, text, text, text, uuid, uuid, jsonb
) to service_role;
