-- Franchise analytics and connector foundation.
--
-- This migration is intentionally additive. Browser and mobile clients read
-- only tenant-scoped definitions, rollups, reports, and connector status.
-- Raw telemetry, consent history, credentials, OAuth state, webhooks, and job
-- queues remain server-only. Credentials are represented by opaque handles;
-- provider secrets never live in an exposed table.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

-- Shared immutable-history guards. Retention is allowed to delete raw
-- analytics, but neither raw events nor audit records may be rewritten.
create or replace function app.reject_record_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'record_is_immutable';
end $$;

create or replace function app.reject_record_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'record_is_append_only';
end $$;

revoke all on function app.reject_record_update() from public, anon, authenticated;
revoke all on function app.reject_record_mutation() from public, anon, authenticated;

-- Analytics definitions ----------------------------------------------------

create table public.analytics_event_catalog (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands (id) on delete cascade,
  event_key text not null check (event_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  schema_version integer not null default 1 check (schema_version > 0),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  description text not null default '',
  purpose text not null check (purpose in ('essential', 'behavioral')),
  allowed_surfaces text[] not null default '{}'
    check (allowed_surfaces <@ array['customer', 'operator', 'kiosk', 'display', 'hq']::text[]),
  property_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(property_schema) = 'object' and pg_column_size(property_schema) <= 16384),
  data_classification text not null default 'pseudonymous'
    check (data_classification in ('anonymous', 'pseudonymous', 'operational')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index analytics_event_catalog_global_key_idx
  on public.analytics_event_catalog (event_key, schema_version)
  where brand_id is null;
create unique index analytics_event_catalog_brand_key_idx
  on public.analytics_event_catalog (brand_id, event_key, schema_version)
  where brand_id is not null;
create index analytics_event_catalog_brand_active_idx
  on public.analytics_event_catalog (brand_id, is_active, event_key);

create table public.analytics_funnel_definitions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  funnel_key text not null check (funnel_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  version integer not null default 1 check (version > 0),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  surfaces text[] not null default '{}'
    check (surfaces <@ array['customer', 'operator', 'kiosk', 'display', 'hq']::text[]),
  steps jsonb not null check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 2 and 32
    and pg_column_size(steps) <= 32768
  ),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, funnel_key, version)
);

create index analytics_funnels_brand_active_idx
  on public.analytics_funnel_definitions (brand_id, is_active, funnel_key);
create index analytics_funnels_created_by_idx
  on public.analytics_funnel_definitions (created_by) where created_by is not null;

create table public.analytics_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  metric_key text not null check (metric_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  version integer not null default 1 check (version > 0),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  formula_kind text not null check (formula_kind in (
    'count', 'distinct_count', 'sum', 'average', 'ratio', 'percentile', 'duration'
  )),
  source_event_keys text[] not null default '{}',
  configuration jsonb not null default '{}'::jsonb
    check (jsonb_typeof(configuration) = 'object' and pg_column_size(configuration) <= 16384),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, metric_key, version)
);

create index analytics_metrics_brand_active_idx
  on public.analytics_metric_definitions (brand_id, is_active, metric_key);
create index analytics_metrics_created_by_idx
  on public.analytics_metric_definitions (created_by) where created_by is not null;

-- Raw analytics ------------------------------------------------------------

create table public.analytics_events (
  id uuid not null default gen_random_uuid(),
  client_event_id uuid not null,
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
  surface text not null check (surface in ('customer', 'operator', 'kiosk', 'display', 'hq')),
  event_key text not null check (event_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  event_version integer not null default 1 check (event_version > 0),
  app_version text not null default 'unknown' check (length(app_version) between 1 and 64),
  build_version text not null default 'unknown' check (length(build_version) between 1 and 64),
  actor_hash text check (actor_hash is null or length(actor_hash) between 32 and 128),
  session_hash text not null check (length(session_hash) between 32 and 128),
  flow_key text check (flow_key is null or flow_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  step_key text check (step_key is null or step_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  metric_key text check (metric_key is null or metric_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  outcome text check (outcome is null or outcome in ('success', 'failure', 'abandoned', 'cancelled', 'unknown')),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  consent_basis text not null check (consent_basis in ('essential', 'consented', 'not_required')),
  properties jsonb not null default '{}'::jsonb
    check (jsonb_typeof(properties) = 'object' and pg_column_size(properties) <= 8192),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (occurred_at, id),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete set null (location_id)
) partition by range (occurred_at);

create index analytics_events_brand_time_idx
  on public.analytics_events (brand_id, occurred_at desc);
create index analytics_events_location_time_idx
  on public.analytics_events (brand_id, location_id, occurred_at desc)
  where location_id is not null;
create index analytics_events_location_fk_idx
  on public.analytics_events (location_id, brand_id)
  where location_id is not null;
create index analytics_events_event_time_idx
  on public.analytics_events (brand_id, event_key, occurred_at desc);
create index analytics_events_session_time_idx
  on public.analytics_events (brand_id, session_hash, occurred_at desc);

-- Keep three retention months behind and eighteen months ahead. Future
-- releases extend this window before it expires; inserts fail closed if a
-- partition is unexpectedly missing instead of silently becoming unbounded.
do $$
declare
  month_start date;
  month_end date;
  partition_name text;
begin
  for offset_month in -3..18 loop
    month_start := (date_trunc('month', current_date) + make_interval(months => offset_month))::date;
    month_end := (month_start + interval '1 month')::date;
    partition_name := 'analytics_events_' || to_char(month_start, 'YYYYMM');
    execute format(
      'create table if not exists public.%I partition of public.analytics_events for values from (%L) to (%L)',
      partition_name,
      month_start,
      month_end
    );
    execute format('alter table public.%I enable row level security', partition_name);
    execute format('alter table public.%I force row level security', partition_name);
    execute format('revoke all on table public.%I from anon, authenticated', partition_name);
    execute format('grant all on table public.%I to service_role', partition_name);
  end loop;
end $$;

create trigger analytics_events_no_update
  before update on public.analytics_events
  for each row execute function app.reject_record_update();

create table public.analytics_hourly_rollups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
  surface text not null check (surface in ('customer', 'operator', 'kiosk', 'display', 'hq')),
  bucket_start timestamptz not null check (date_trunc('hour', bucket_start) = bucket_start),
  metric_key text not null check (metric_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  dimensions_key text not null default '' check (length(dimensions_key) <= 256),
  dimensions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dimensions) = 'object' and pg_column_size(dimensions) <= 8192),
  event_count bigint not null default 0 check (event_count >= 0),
  unique_actors bigint not null default 0 check (unique_actors >= 0),
  success_count bigint not null default 0 check (success_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0),
  total_value numeric not null default 0,
  duration_p50_ms integer check (duration_p50_ms is null or duration_p50_ms >= 0),
  duration_p95_ms integer check (duration_p95_ms is null or duration_p95_ms >= 0),
  computed_at timestamptz not null default now(),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade
);

create unique index analytics_hourly_rollups_key_idx
  on public.analytics_hourly_rollups
    (brand_id, location_id, surface, bucket_start, metric_key, dimensions_key)
  nulls not distinct;
create index analytics_hourly_rollups_query_idx
  on public.analytics_hourly_rollups (brand_id, bucket_start desc, surface);
create index analytics_hourly_rollups_location_fk_idx
  on public.analytics_hourly_rollups (location_id, brand_id)
  where location_id is not null;

create table public.analytics_daily_rollups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
  surface text not null check (surface in ('customer', 'operator', 'kiosk', 'display', 'hq')),
  day date not null,
  metric_key text not null check (metric_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  dimensions_key text not null default '' check (length(dimensions_key) <= 256),
  dimensions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dimensions) = 'object' and pg_column_size(dimensions) <= 8192),
  event_count bigint not null default 0 check (event_count >= 0),
  unique_actors bigint not null default 0 check (unique_actors >= 0),
  success_count bigint not null default 0 check (success_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0),
  total_value numeric not null default 0,
  duration_p50_ms integer check (duration_p50_ms is null or duration_p50_ms >= 0),
  duration_p95_ms integer check (duration_p95_ms is null or duration_p95_ms >= 0),
  computed_at timestamptz not null default now(),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade
);

create unique index analytics_daily_rollups_key_idx
  on public.analytics_daily_rollups
    (brand_id, location_id, surface, day, metric_key, dimensions_key)
  nulls not distinct;
create index analytics_daily_rollups_query_idx
  on public.analytics_daily_rollups (brand_id, day desc, surface);
create index analytics_daily_rollups_location_fk_idx
  on public.analytics_daily_rollups (location_id, brand_id)
  where location_id is not null;

create table public.analytics_saved_reports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
  created_by uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  view_key text not null check (view_key in (
    'overview', 'apps', 'commerce', 'operations', 'training', 'growth', 'reliability'
  )),
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 16384),
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade
);

create index analytics_saved_reports_brand_idx
  on public.analytics_saved_reports (brand_id, created_at desc);
create index analytics_saved_reports_created_by_idx
  on public.analytics_saved_reports (created_by, updated_at desc);
create index analytics_saved_reports_location_fk_idx
  on public.analytics_saved_reports (location_id, brand_id)
  where location_id is not null;

create table public.analytics_consent_records (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  surface text not null check (surface in ('customer', 'operator', 'kiosk', 'display', 'hq')),
  actor_hash text not null check (length(actor_hash) between 32 and 128),
  consent_state text not null check (consent_state in ('unknown', 'essential_only', 'granted', 'revoked')),
  policy_version text not null check (length(policy_version) between 1 and 64),
  source text not null check (source in ('app', 'web', 'kiosk', 'operator', 'hq', 'server')),
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at)
);

create index analytics_consent_lookup_idx
  on public.analytics_consent_records (brand_id, actor_hash, surface, effective_at desc);
create trigger analytics_consent_no_mutation
  before update or delete on public.analytics_consent_records
  for each row execute function app.reject_record_mutation();

create table public.analytics_ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key uuid not null unique,
  brand_id uuid not null references public.brands (id) on delete cascade,
  surface text not null check (surface in ('customer', 'operator', 'kiosk', 'display', 'hq')),
  status text not null default 'received'
    check (status in ('received', 'processing', 'accepted', 'partially_accepted', 'rejected', 'failed')),
  received_count integer not null check (received_count between 0 and 50),
  accepted_count integer not null default 0 check (accepted_count between 0 and 50),
  rejected_count integer not null default 0 check (rejected_count between 0 and 50),
  error_code text,
  correlation_id uuid not null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  check (accepted_count + rejected_count <= received_count),
  check (completed_at is null or completed_at >= received_at)
);

create index analytics_ingestion_batches_brand_time_idx
  on public.analytics_ingestion_batches (brand_id, received_at desc);
create index analytics_ingestion_batches_status_idx
  on public.analytics_ingestion_batches (status, received_at)
  where status in ('received', 'processing', 'failed');

-- Connector catalog --------------------------------------------------------

create table public.connector_registry (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique check (provider_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  category text not null check (category in (
    'google', 'commerce', 'finance', 'communications', 'platform', 'developer', 'distribution'
  )),
  availability text not null default 'uncertified' check (availability in (
    'available', 'setup_required', 'provider_approval_required', 'uncertified', 'coming_soon', 'disabled'
  )),
  description text not null default '',
  logo_path text not null,
  logo_source_url text not null check (logo_source_url ~ '^https://'),
  logo_license text not null,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  adapter_contract_version text not null default '1.0.0',
  documentation_url text check (documentation_url is null or documentation_url ~ '^https://'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index connector_registry_catalog_idx
  on public.connector_registry (is_active, category, display_name);

create table public.connector_capabilities (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.connector_registry (id) on delete cascade,
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_.-]{0,95}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  access_mode text not null check (access_mode in ('read', 'write', 'read_write', 'webhook', 'health')),
  oauth_scopes text[] not null default '{}',
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, capability_key)
);

create index connector_capabilities_provider_idx
  on public.connector_capabilities (provider_id, is_active, capability_key);

create table public.connector_certifications (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.connector_capabilities (id) on delete cascade,
  environment text not null default 'sandbox'
    check (environment in ('sandbox', 'staging', 'production')),
  status text not null default 'not_started'
    check (status in ('not_started', 'running', 'passed', 'failed', 'expired')),
  contract_version text not null,
  evidence_url text check (evidence_url is null or evidence_url ~ '^https://'),
  certified_at timestamptz,
  valid_until timestamptz,
  notes text not null default '',
  certified_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (capability_id, environment, contract_version),
  check (valid_until is null or certified_at is not null),
  check (valid_until is null or valid_until > certified_at)
);

create index connector_certifications_current_idx
  on public.connector_certifications (capability_id, environment, status, valid_until);
create index connector_certifications_certified_by_idx
  on public.connector_certifications (certified_by)
  where certified_by is not null;

create table public.credential_references (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  provider_id uuid not null references public.connector_registry (id) on delete restrict,
  secret_handle text not null check (length(secret_handle) between 8 and 512),
  account_label text not null default '' check (length(account_label) <= 160),
  granted_scopes text[] not null default '{}',
  expires_at timestamptz,
  last_rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, brand_id),
  unique (brand_id, provider_id, secret_handle)
);

create index credential_references_provider_idx
  on public.credential_references (brand_id, provider_id, revoked_at);
create index credential_references_provider_fk_idx
  on public.credential_references (provider_id);

create table public.connector_installations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  provider_id uuid not null references public.connector_registry (id) on delete restrict,
  credential_reference_id uuid,
  environment text not null default 'production'
    check (environment in ('development', 'staging', 'production')),
  status text not null default 'available' check (status in (
    'available', 'setup_required', 'provider_approval_required', 'connecting',
    'connected_healthy', 'connected_degraded', 'reauthorization_required',
    'disabled', 'revoked', 'uncertified'
  )),
  enabled_capabilities text[] not null default '{}',
  external_account_label text not null default '' check (length(external_account_label) <= 160),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  last_synced_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, brand_id),
  unique (brand_id, provider_id, environment),
  foreign key (credential_reference_id, brand_id)
    references public.credential_references (id, brand_id) on delete set null (credential_reference_id)
);

create index connector_installations_brand_status_idx
  on public.connector_installations (brand_id, status, updated_at desc);
create index connector_installations_provider_idx
  on public.connector_installations (provider_id, status);
create index connector_installations_credential_fk_idx
  on public.connector_installations (credential_reference_id, brand_id)
  where credential_reference_id is not null;
create index connector_installations_connected_by_idx
  on public.connector_installations (connected_by)
  where connected_by is not null;

create table public.connector_location_mappings (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid not null,
  location_id uuid not null,
  external_location_id text not null check (length(external_location_id) between 1 and 255),
  external_location_label text not null default '' check (length(external_location_label) <= 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  unique (installation_id, location_id),
  unique (installation_id, external_location_id)
);

create index connector_location_mappings_brand_location_idx
  on public.connector_location_mappings (brand_id, location_id, is_active);
create index connector_location_mappings_installation_fk_idx
  on public.connector_location_mappings (installation_id, brand_id);
create index connector_location_mappings_location_fk_idx
  on public.connector_location_mappings (location_id, brand_id);

create table public.connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid not null,
  location_id uuid,
  capability_key text not null,
  direction text not null check (direction in ('import', 'export', 'bidirectional', 'health')),
  trigger_kind text not null check (trigger_kind in ('manual', 'cron', 'webhook', 'reconciliation', 'system')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled')),
  correlation_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 255),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  records_read bigint not null default 0 check (records_read >= 0),
  records_written bigint not null default 0 check (records_written >= 0),
  records_rejected bigint not null default 0 check (records_rejected >= 0),
  error_code text,
  retryable boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete set null (location_id),
  unique (brand_id, idempotency_key),
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create index connector_sync_runs_installation_time_idx
  on public.connector_sync_runs (installation_id, created_at desc);
create index connector_sync_runs_installation_fk_idx
  on public.connector_sync_runs (installation_id, brand_id);
create index connector_sync_runs_location_fk_idx
  on public.connector_sync_runs (location_id, brand_id)
  where location_id is not null;
create index connector_sync_runs_pending_idx
  on public.connector_sync_runs (status, created_at)
  where status in ('queued', 'running', 'failed');

create table public.connector_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid not null,
  location_id uuid,
  status text not null check (status in ('healthy', 'degraded', 'down', 'reauthorization_required', 'unknown')),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 300000),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  circuit_state text not null default 'closed' check (circuit_state in ('closed', 'open', 'half_open')),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 8192),
  observed_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete set null (location_id)
);

create index connector_health_installation_time_idx
  on public.connector_health_snapshots (installation_id, observed_at desc);
create index connector_health_installation_fk_idx
  on public.connector_health_snapshots (installation_id, brand_id);
create index connector_health_location_fk_idx
  on public.connector_health_snapshots (location_id, brand_id)
  where location_id is not null;
create index connector_health_brand_status_idx
  on public.connector_health_snapshots (brand_id, status, observed_at desc);
create trigger connector_health_no_mutation
  before update or delete on public.connector_health_snapshots
  for each row execute function app.reject_record_mutation();

create table public.connector_audit_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid,
  location_id uuid,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  outcome text not null check (outcome in ('success', 'failure', 'denied', 'cancelled')),
  correlation_id uuid not null,
  source text not null check (source in ('hq', 'api', 'cron', 'webhook', 'system')),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 8192),
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete set null (installation_id),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete set null (location_id)
);

create index connector_audit_brand_time_idx
  on public.connector_audit_events (brand_id, created_at desc);
create index connector_audit_installation_time_idx
  on public.connector_audit_events (installation_id, created_at desc)
  where installation_id is not null;
create index connector_audit_installation_fk_idx
  on public.connector_audit_events (installation_id, brand_id)
  where installation_id is not null;
create index connector_audit_location_fk_idx
  on public.connector_audit_events (location_id, brand_id)
  where location_id is not null;
create index connector_audit_actor_idx
  on public.connector_audit_events (actor_user_id)
  where actor_user_id is not null;
create trigger connector_audit_no_mutation
  before update or delete on public.connector_audit_events
  for each row execute function app.reject_record_mutation();

-- A connected installation is valid only when every enabled capability is
-- present in the provider catalog and has a current sandbox certification.
create or replace function app.enforce_connector_certification() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('connected_healthy', 'connected_degraded') then
    if cardinality(new.enabled_capabilities) = 0 or exists (
      select 1
      from unnest(new.enabled_capabilities) requested(capability_key)
      where not exists (
        select 1
        from public.connector_capabilities capability
        join public.connector_certifications certification
          on certification.capability_id = capability.id
        where capability.provider_id = new.provider_id
          and capability.capability_key = requested.capability_key
          and capability.is_active
          and certification.environment = 'sandbox'
          and certification.status = 'passed'
          and certification.certified_at is not null
          and (certification.valid_until is null or certification.valid_until > now())
      )
    ) then
      raise exception using errcode = '23514', message = 'connector_capability_not_certified';
    end if;
  end if;
  return new;
end $$;

revoke all on function app.enforce_connector_certification() from public, anon, authenticated;
create trigger connector_installations_require_certification
  before insert or update of status, enabled_capabilities, provider_id
  on public.connector_installations
  for each row execute function app.enforce_connector_certification();

-- The hosted scheduler calls this service-only helper. Cutoffs are arguments
-- so retention policy can evolve without replacing the function, while the
-- guards prevent an accidental future-dated purge.
create or replace function public.prune_analytics_retention(
  raw_before timestamptz,
  hourly_before timestamptz,
  daily_before date
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  raw_deleted bigint;
  idempotency_deleted bigint;
  hourly_deleted bigint;
  daily_deleted bigint;
begin
  if raw_before > now() - interval '30 days'
     or hourly_before > now() - interval '30 days'
     or daily_before > current_date - interval '1 month' then
    raise exception using errcode = '22023', message = 'analytics_retention_cutoff_too_recent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('analytics-retention', 0));

  delete from public.analytics_events where occurred_at < raw_before;
  get diagnostics raw_deleted = row_count;
  delete from app_private.analytics_event_idempotency
  where event_occurred_at < raw_before;
  get diagnostics idempotency_deleted = row_count;
  delete from public.analytics_hourly_rollups where bucket_start < hourly_before;
  get diagnostics hourly_deleted = row_count;
  delete from public.analytics_daily_rollups where day < daily_before;
  get diagnostics daily_deleted = row_count;

  return jsonb_build_object(
    'rawDeleted', raw_deleted,
    'idempotencyDeleted', idempotency_deleted,
    'hourlyDeleted', hourly_deleted,
    'dailyDeleted', daily_deleted
  );
end $$;

revoke all on function public.prune_analytics_retention(timestamptz, timestamptz, date)
  from public, anon, authenticated;
grant execute on function public.prune_analytics_retention(timestamptz, timestamptz, date)
  to service_role;

-- Private orchestration state ---------------------------------------------

create table app_private.analytics_event_idempotency (
  brand_id uuid not null references public.brands (id) on delete cascade,
  client_event_id uuid not null,
  event_occurred_at timestamptz not null,
  accepted_at timestamptz not null default now(),
  primary key (brand_id, client_event_id)
);

alter table public.analytics_events
  add constraint analytics_events_client_event_fk
  foreign key (brand_id, client_event_id)
  references app_private.analytics_event_idempotency (brand_id, client_event_id)
  on delete restrict;
create index analytics_events_client_event_fk_idx
  on public.analytics_events (brand_id, client_event_id);

create table app_private.analytics_dead_letters (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  batch_id uuid references public.analytics_ingestion_batches (id) on delete cascade,
  client_event_id uuid,
  error_code text not null,
  safe_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_detail) = 'object' and pg_column_size(safe_detail) <= 8192),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index analytics_dead_letters_retry_idx
  on app_private.analytics_dead_letters (next_attempt_at, created_at)
  where resolved_at is null;
create index analytics_dead_letters_brand_idx
  on app_private.analytics_dead_letters (brand_id);
create index analytics_dead_letters_batch_idx
  on app_private.analytics_dead_letters (batch_id)
  where batch_id is not null;

create table app_private.connector_oauth_states (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  provider_id uuid not null references public.connector_registry (id) on delete cascade,
  installation_id uuid,
  requested_by uuid not null references auth.users (id) on delete cascade,
  state_hash text not null unique check (length(state_hash) between 32 and 128),
  pkce_verifier_reference text not null check (length(pkce_verifier_reference) between 8 and 512),
  requested_scopes text[] not null default '{}',
  redirect_uri text not null check (redirect_uri ~ '^https://'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index connector_oauth_states_expiry_idx
  on app_private.connector_oauth_states (expires_at)
  where consumed_at is null;
create index connector_oauth_states_provider_idx
  on app_private.connector_oauth_states (provider_id);
create index connector_oauth_states_installation_fk_idx
  on app_private.connector_oauth_states (installation_id, brand_id)
  where installation_id is not null;
create index connector_oauth_states_requested_by_idx
  on app_private.connector_oauth_states (requested_by);

create table app_private.connector_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.connector_registry (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  installation_id uuid,
  provider_event_id text not null check (length(provider_event_id) between 1 and 255),
  signature_verified boolean not null default false,
  payload jsonb not null check (jsonb_typeof(payload) in ('object', 'array') and pg_column_size(payload) <= 1048576),
  safe_headers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_headers) = 'object' and pg_column_size(safe_headers) <= 16384),
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'rejected', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  unique (provider_id, provider_event_id)
);

create index connector_webhook_inbox_pending_idx
  on app_private.connector_webhook_inbox (status, received_at)
  where status in ('received', 'processing', 'failed');
create index connector_webhook_inbox_brand_idx
  on app_private.connector_webhook_inbox (brand_id)
  where brand_id is not null;
create index connector_webhook_inbox_installation_fk_idx
  on app_private.connector_webhook_inbox (installation_id, brand_id)
  where installation_id is not null;

create table app_private.connector_outbox (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid not null,
  capability_key text not null,
  operation_key text not null,
  idempotency_key text not null,
  request_reference text not null check (length(request_reference) between 8 and 512),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'delivered', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  correlation_id uuid not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  unique (brand_id, idempotency_key),
  check (deadline_at > created_at)
);

create index connector_outbox_pending_idx
  on app_private.connector_outbox (next_attempt_at, created_at)
  where status in ('queued', 'failed');
create index connector_outbox_installation_fk_idx
  on app_private.connector_outbox (installation_id, brand_id);

create table app_private.connector_dead_letters (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid not null,
  source_kind text not null check (source_kind in ('webhook', 'outbox', 'sync', 'reconciliation')),
  source_id uuid,
  error_code text not null,
  safe_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_detail) = 'object' and pg_column_size(safe_detail) <= 8192),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade
);

create index connector_dead_letters_retry_idx
  on app_private.connector_dead_letters (next_attempt_at, created_at)
  where resolved_at is null;
create index connector_dead_letters_installation_fk_idx
  on app_private.connector_dead_letters (installation_id, brand_id);

create table app_private.connector_idempotency_keys (
  brand_id uuid not null references public.brands (id) on delete cascade,
  installation_id uuid not null,
  idempotency_key text not null,
  request_hash text not null check (length(request_hash) between 32 and 128),
  response_reference text check (response_reference is null or length(response_reference) between 8 and 512),
  status text not null check (status in ('processing', 'completed', 'failed')),
  locked_until timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, installation_id, idempotency_key),
  foreign key (installation_id, brand_id)
    references public.connector_installations (id, brand_id) on delete cascade,
  check (expires_at > created_at)
);

create index connector_idempotency_expiry_idx
  on app_private.connector_idempotency_keys (expires_at);

-- Atomic ingestion boundary used by the deployed API. The argument names
-- are part of the PostgREST RPC contract:
--   brand, surface, batch_key, correlation, events
-- Duplicate client event IDs are counted as rejected but do not fail a retry;
-- any malformed event aborts the entire transaction without partial writes.
create or replace function public.ingest_analytics_batch(
  brand uuid,
  surface text,
  batch_key uuid,
  correlation uuid,
  events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_payload jsonb;
  existing_batch public.analytics_ingestion_batches%rowtype;
  received_total integer;
  accepted_total integer := 0;
  rejected_total integer := 0;
  reservation_count integer;
  client_event uuid;
  event_time timestamptz;
  event_location uuid;
  event_name text;
  event_purpose text;
begin
  if surface not in ('customer', 'operator', 'kiosk', 'display', 'hq') then
    raise exception using errcode = '22023', message = 'analytics_surface_invalid';
  end if;
  if jsonb_typeof(events) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'analytics_batch_must_be_array';
  end if;

  received_total := jsonb_array_length(events);
  if received_total not between 1 and 50 or pg_column_size(events) > 524288 then
    raise exception using errcode = '22023', message = 'analytics_batch_limit_exceeded';
  end if;
  if not exists (select 1 from public.brands tenant where tenant.id = brand) then
    raise exception using errcode = '23503', message = 'analytics_brand_not_found';
  end if;

  -- One lock closes both the concurrent batch-key replay race and the
  -- per-tenant/surface rate-check race.
  perform pg_advisory_xact_lock(hashtextextended(
    brand::text || ':' || surface || ':analytics-ingestion-rate', 0
  ));

  select batch.* into existing_batch
  from public.analytics_ingestion_batches batch
  where batch.batch_key = ingest_analytics_batch.batch_key;

  if found then
    if existing_batch.brand_id is distinct from brand
       or existing_batch.surface is distinct from surface
       or existing_batch.correlation_id is distinct from correlation
       or existing_batch.received_count is distinct from received_total then
      raise exception using errcode = '23505', message = 'analytics_batch_key_conflict';
    end if;
    return jsonb_build_object(
      'batchId', existing_batch.id,
      'status', existing_batch.status,
      'receivedCount', existing_batch.received_count,
      'acceptedCount', existing_batch.accepted_count,
      'rejectedCount', existing_batch.rejected_count,
      'replayed', true
    );
  end if;

  if (
    select count(*)
    from public.analytics_ingestion_batches recent_batch
    where recent_batch.brand_id = brand
      and recent_batch.surface = ingest_analytics_batch.surface
      and recent_batch.received_at >= now() - interval '1 minute'
  ) >= 120 then
    raise exception using errcode = 'P0001', message = 'analytics_rate_limited';
  end if;

  insert into public.analytics_ingestion_batches (
    batch_key, brand_id, surface, status, received_count, correlation_id
  ) values (
    batch_key, brand, surface, 'processing', received_total, correlation
  ) returning * into existing_batch;

  for event_payload in select payload.value from jsonb_array_elements(events) payload(value)
  loop
    if jsonb_typeof(event_payload) is distinct from 'object'
       or event_payload ->> 'brandId' is distinct from brand::text
       or event_payload ->> 'surface' is distinct from surface
       or event_payload ->> 'schemaVersion' is distinct from '1' then
      raise exception using errcode = '22023', message = 'analytics_event_envelope_invalid';
    end if;
    if coalesce(event_payload ->> 'clientEventId', '')
         !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(event_payload ->> 'occurredAt', '')
         !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$' then
      raise exception using errcode = '22023', message = 'analytics_event_identity_invalid';
    end if;

    client_event := (event_payload ->> 'clientEventId')::uuid;
    event_time := (event_payload ->> 'occurredAt')::timestamptz;
    event_name := event_payload ->> 'eventName';
    event_purpose := event_payload ->> 'purpose';
    event_location := null;

    if event_time < now() - interval '7 days' or event_time > now() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'analytics_event_timestamp_out_of_range';
    end if;
    if event_payload ? 'locationId' then
      if coalesce(event_payload ->> 'locationId', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'analytics_event_location_invalid';
      end if;
      event_location := (event_payload ->> 'locationId')::uuid;
    end if;
    if jsonb_typeof(coalesce(event_payload -> 'properties', '{}'::jsonb)) is distinct from 'object'
       or pg_column_size(coalesce(event_payload -> 'properties', '{}'::jsonb)) > 8192
       or not exists (
         select 1
         from public.analytics_event_catalog catalog
         where catalog.event_key = event_name
           and catalog.schema_version = 1
           and catalog.purpose = event_purpose
           and catalog.is_active
           and surface = any(catalog.allowed_surfaces)
           and (catalog.brand_id is null or catalog.brand_id = brand)
       ) then
      raise exception using errcode = '22023', message = 'analytics_event_definition_invalid';
    end if;

    insert into app_private.analytics_event_idempotency (
      brand_id, client_event_id, event_occurred_at
    ) values (
      brand, client_event, event_time
    ) on conflict (brand_id, client_event_id) do nothing;
    get diagnostics reservation_count = row_count;

    if reservation_count = 0 then
      rejected_total := rejected_total + 1;
      continue;
    end if;

    insert into public.analytics_events (
      client_event_id, brand_id, location_id, surface, event_key, event_version,
      app_version, build_version, actor_hash, session_hash, flow_key, step_key,
      metric_key, outcome, duration_ms, consent_basis, properties, occurred_at
    ) values (
      client_event,
      brand,
      event_location,
      surface,
      event_name,
      (event_payload ->> 'schemaVersion')::integer,
      event_payload ->> 'appVersion',
      coalesce(nullif(event_payload ->> 'buildVersion', ''), event_payload ->> 'appVersion'),
      nullif(event_payload ->> 'actorHash', ''),
      event_payload ->> 'sessionHash',
      nullif(event_payload ->> 'flowKey', ''),
      nullif(event_payload ->> 'stepKey', ''),
      nullif(event_payload ->> 'metricKey', ''),
      coalesce(nullif(event_payload ->> 'outcome', ''), 'unknown'),
      case when event_payload ? 'durationMs' then (event_payload ->> 'durationMs')::integer end,
      case when event_purpose = 'essential' then 'essential' else 'consented' end,
      coalesce(event_payload -> 'properties', '{}'::jsonb),
      event_time
    );
    accepted_total := accepted_total + 1;
  end loop;

  update public.analytics_ingestion_batches batch
  set accepted_count = accepted_total,
      rejected_count = rejected_total,
      status = case
        when accepted_total = 0 then 'rejected'
        when rejected_total = 0 then 'accepted'
        else 'partially_accepted'
      end,
      completed_at = now()
  where batch.id = existing_batch.id
  returning * into existing_batch;

  return jsonb_build_object(
    'batchId', existing_batch.id,
    'status', existing_batch.status,
    'receivedCount', received_total,
    'acceptedCount', accepted_total,
    'rejectedCount', rejected_total,
    'replayed', false
  );
end $$;

revoke all on function public.ingest_analytics_batch(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_analytics_batch(uuid, text, uuid, uuid, jsonb)
  to service_role;

-- Updated-at behavior ------------------------------------------------------

create trigger analytics_event_catalog_touch before update on public.analytics_event_catalog
  for each row execute function app.touch_updated_at();
create trigger analytics_funnel_definitions_touch before update on public.analytics_funnel_definitions
  for each row execute function app.touch_updated_at();
create trigger analytics_metric_definitions_touch before update on public.analytics_metric_definitions
  for each row execute function app.touch_updated_at();
create trigger analytics_saved_reports_touch before update on public.analytics_saved_reports
  for each row execute function app.touch_updated_at();
create trigger connector_registry_touch before update on public.connector_registry
  for each row execute function app.touch_updated_at();
create trigger connector_capabilities_touch before update on public.connector_capabilities
  for each row execute function app.touch_updated_at();
create trigger connector_certifications_touch before update on public.connector_certifications
  for each row execute function app.touch_updated_at();
create trigger credential_references_touch before update on public.credential_references
  for each row execute function app.touch_updated_at();
create trigger connector_installations_touch before update on public.connector_installations
  for each row execute function app.touch_updated_at();
create trigger connector_location_mappings_touch before update on public.connector_location_mappings
  for each row execute function app.touch_updated_at();
create trigger connector_idempotency_touch before update on app_private.connector_idempotency_keys
  for each row execute function app.touch_updated_at();

-- RLS and least-privilege grants ------------------------------------------

alter table public.analytics_event_catalog enable row level security;
alter table public.analytics_funnel_definitions enable row level security;
alter table public.analytics_metric_definitions enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_hourly_rollups enable row level security;
alter table public.analytics_daily_rollups enable row level security;
alter table public.analytics_saved_reports enable row level security;
alter table public.analytics_consent_records enable row level security;
alter table public.analytics_ingestion_batches enable row level security;
alter table public.connector_registry enable row level security;
alter table public.connector_capabilities enable row level security;
alter table public.connector_certifications enable row level security;
alter table public.credential_references enable row level security;
alter table public.connector_installations enable row level security;
alter table public.connector_location_mappings enable row level security;
alter table public.connector_sync_runs enable row level security;
alter table public.connector_health_snapshots enable row level security;
alter table public.connector_audit_events enable row level security;

alter table public.analytics_event_catalog force row level security;
alter table public.analytics_funnel_definitions force row level security;
alter table public.analytics_metric_definitions force row level security;
alter table public.analytics_events force row level security;
alter table public.analytics_hourly_rollups force row level security;
alter table public.analytics_daily_rollups force row level security;
alter table public.analytics_saved_reports force row level security;
alter table public.analytics_consent_records force row level security;
alter table public.analytics_ingestion_batches force row level security;
alter table public.connector_registry force row level security;
alter table public.connector_capabilities force row level security;
alter table public.connector_certifications force row level security;
alter table public.credential_references force row level security;
alter table public.connector_installations force row level security;
alter table public.connector_location_mappings force row level security;
alter table public.connector_sync_runs force row level security;
alter table public.connector_health_snapshots force row level security;
alter table public.connector_audit_events force row level security;

alter table app_private.analytics_event_idempotency enable row level security;
alter table app_private.analytics_dead_letters enable row level security;
alter table app_private.connector_oauth_states enable row level security;
alter table app_private.connector_webhook_inbox enable row level security;
alter table app_private.connector_outbox enable row level security;
alter table app_private.connector_dead_letters enable row level security;
alter table app_private.connector_idempotency_keys enable row level security;

alter table app_private.analytics_event_idempotency force row level security;
alter table app_private.analytics_dead_letters force row level security;
alter table app_private.connector_oauth_states force row level security;
alter table app_private.connector_webhook_inbox force row level security;
alter table app_private.connector_outbox force row level security;
alter table app_private.connector_dead_letters force row level security;
alter table app_private.connector_idempotency_keys force row level security;

create policy analytics_event_catalog_select on public.analytics_event_catalog
  for select to authenticated using (
    app.is_platform_admin()
    or (brand_id is null and app.jwt_role() in ('brand_owner', 'location_manager'))
    or app.is_brand_manager(brand_id)
  );
create policy analytics_event_catalog_insert on public.analytics_event_catalog
  for insert to authenticated with check (app.is_platform_admin());
create policy analytics_event_catalog_update on public.analytics_event_catalog
  for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy analytics_event_catalog_delete on public.analytics_event_catalog
  for delete to authenticated using (app.is_platform_admin());

create policy analytics_funnels_select on public.analytics_funnel_definitions
  for select to authenticated using (app.is_brand_manager(brand_id));
create policy analytics_funnels_insert on public.analytics_funnel_definitions
  for insert to authenticated with check (
    app.is_brand_owner(brand_id) and created_by = (select auth.uid())
  );
create policy analytics_funnels_update on public.analytics_funnel_definitions
  for update to authenticated using (app.is_brand_owner(brand_id))
  with check (app.is_brand_owner(brand_id));
create policy analytics_funnels_delete on public.analytics_funnel_definitions
  for delete to authenticated using (app.is_brand_owner(brand_id));

create policy analytics_metrics_select on public.analytics_metric_definitions
  for select to authenticated using (app.is_brand_manager(brand_id));
create policy analytics_metrics_insert on public.analytics_metric_definitions
  for insert to authenticated with check (
    app.is_brand_owner(brand_id) and created_by = (select auth.uid())
  );
create policy analytics_metrics_update on public.analytics_metric_definitions
  for update to authenticated using (app.is_brand_owner(brand_id))
  with check (app.is_brand_owner(brand_id));
create policy analytics_metrics_delete on public.analytics_metric_definitions
  for delete to authenticated using (app.is_brand_owner(brand_id));

create policy analytics_events_service on public.analytics_events
  for all to service_role using (true) with check (true);
create policy analytics_hourly_rollups_select on public.analytics_hourly_rollups
  for select to authenticated using (
    app.is_brand_owner(brand_id)
    or (location_id is not null and app.manages_location(brand_id, location_id))
  );
create policy analytics_daily_rollups_select on public.analytics_daily_rollups
  for select to authenticated using (
    app.is_brand_owner(brand_id)
    or (location_id is not null and app.manages_location(brand_id, location_id))
  );

create policy analytics_saved_reports_select on public.analytics_saved_reports
  for select to authenticated using (
    app.is_brand_owner(brand_id)
    or (created_by = (select auth.uid()) and location_id is not null
      and app.manages_location(brand_id, location_id))
    or (is_shared and location_id is not null and app.manages_location(brand_id, location_id))
  );
create policy analytics_saved_reports_insert on public.analytics_saved_reports
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and (app.is_brand_owner(brand_id)
      or (location_id is not null and app.manages_location(brand_id, location_id)))
  );
create policy analytics_saved_reports_update on public.analytics_saved_reports
  for update to authenticated using (
    app.is_brand_owner(brand_id)
    or (created_by = (select auth.uid()) and location_id is not null
      and app.manages_location(brand_id, location_id))
  ) with check (
    app.is_brand_owner(brand_id)
    or (created_by = (select auth.uid()) and location_id is not null
      and app.manages_location(brand_id, location_id))
  );
create policy analytics_saved_reports_delete on public.analytics_saved_reports
  for delete to authenticated using (
    app.is_brand_owner(brand_id)
    or (created_by = (select auth.uid()) and location_id is not null
      and app.manages_location(brand_id, location_id))
  );

create policy analytics_consent_service on public.analytics_consent_records
  for all to service_role using (true) with check (true);
create policy analytics_ingestion_batches_service on public.analytics_ingestion_batches
  for all to service_role using (true) with check (true);

create policy connector_registry_select on public.connector_registry
  for select to authenticated using (
    app.jwt_role() in ('platform_admin', 'brand_owner', 'location_manager')
  );
create policy connector_registry_insert on public.connector_registry
  for insert to authenticated with check (app.is_platform_admin());
create policy connector_registry_update on public.connector_registry
  for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy connector_registry_delete on public.connector_registry
  for delete to authenticated using (app.is_platform_admin());

create policy connector_capabilities_select on public.connector_capabilities
  for select to authenticated using (
    app.jwt_role() in ('platform_admin', 'brand_owner', 'location_manager')
  );
create policy connector_capabilities_insert on public.connector_capabilities
  for insert to authenticated with check (app.is_platform_admin());
create policy connector_capabilities_update on public.connector_capabilities
  for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy connector_capabilities_delete on public.connector_capabilities
  for delete to authenticated using (app.is_platform_admin());

create policy connector_certifications_select on public.connector_certifications
  for select to authenticated using (
    app.jwt_role() in ('platform_admin', 'brand_owner', 'location_manager')
  );
create policy connector_certifications_insert on public.connector_certifications
  for insert to authenticated with check (app.is_platform_admin());
create policy connector_certifications_update on public.connector_certifications
  for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy connector_certifications_delete on public.connector_certifications
  for delete to authenticated using (app.is_platform_admin());

create policy credential_references_service on public.credential_references
  for all to service_role using (true) with check (true);
create policy connector_installations_select on public.connector_installations
  for select to authenticated using (app.is_brand_manager(brand_id));
create policy connector_installations_service on public.connector_installations
  for all to service_role using (true) with check (true);
create policy connector_location_mappings_select on public.connector_location_mappings
  for select to authenticated using (
    app.is_brand_owner(brand_id) or app.manages_location(brand_id, location_id)
  );
create policy connector_location_mappings_service on public.connector_location_mappings
  for all to service_role using (true) with check (true);
create policy connector_sync_runs_select on public.connector_sync_runs
  for select to authenticated using (app.is_brand_manager(brand_id));
create policy connector_sync_runs_service on public.connector_sync_runs
  for all to service_role using (true) with check (true);
create policy connector_health_snapshots_select on public.connector_health_snapshots
  for select to authenticated using (app.is_brand_manager(brand_id));
create policy connector_health_snapshots_service on public.connector_health_snapshots
  for all to service_role using (true) with check (true);
create policy connector_audit_events_select on public.connector_audit_events
  for select to authenticated using (app.is_brand_manager(brand_id));
create policy connector_audit_events_service on public.connector_audit_events
  for insert to service_role with check (true);

create policy analytics_event_idempotency_service on app_private.analytics_event_idempotency
  for all to service_role using (true) with check (true);
create policy analytics_dead_letters_service on app_private.analytics_dead_letters
  for all to service_role using (true) with check (true);
create policy connector_oauth_states_service on app_private.connector_oauth_states
  for all to service_role using (true) with check (true);
create policy connector_webhook_inbox_service on app_private.connector_webhook_inbox
  for all to service_role using (true) with check (true);
create policy connector_outbox_service on app_private.connector_outbox
  for all to service_role using (true) with check (true);
create policy connector_dead_letters_service on app_private.connector_dead_letters
  for all to service_role using (true) with check (true);
create policy connector_idempotency_keys_service on app_private.connector_idempotency_keys
  for all to service_role using (true) with check (true);

revoke all on table
  public.analytics_event_catalog,
  public.analytics_funnel_definitions,
  public.analytics_metric_definitions,
  public.analytics_events,
  public.analytics_hourly_rollups,
  public.analytics_daily_rollups,
  public.analytics_saved_reports,
  public.analytics_consent_records,
  public.analytics_ingestion_batches,
  public.connector_registry,
  public.connector_capabilities,
  public.connector_certifications,
  public.credential_references,
  public.connector_installations,
  public.connector_location_mappings,
  public.connector_sync_runs,
  public.connector_health_snapshots,
  public.connector_audit_events
from anon, authenticated;

grant select, insert, update, delete on table
  public.analytics_event_catalog,
  public.analytics_funnel_definitions,
  public.analytics_metric_definitions,
  public.analytics_saved_reports,
  public.connector_registry,
  public.connector_capabilities,
  public.connector_certifications
to authenticated;

grant select on table
  public.analytics_hourly_rollups,
  public.analytics_daily_rollups,
  public.connector_installations,
  public.connector_location_mappings,
  public.connector_sync_runs,
  public.connector_health_snapshots,
  public.connector_audit_events
to authenticated;

grant all on table
  public.analytics_event_catalog,
  public.analytics_funnel_definitions,
  public.analytics_metric_definitions,
  public.analytics_events,
  public.analytics_hourly_rollups,
  public.analytics_daily_rollups,
  public.analytics_saved_reports,
  public.analytics_consent_records,
  public.analytics_ingestion_batches,
  public.connector_registry,
  public.connector_capabilities,
  public.connector_certifications,
  public.credential_references,
  public.connector_installations,
  public.connector_location_mappings,
  public.connector_sync_runs,
  public.connector_health_snapshots,
  public.connector_audit_events
to service_role;

revoke all on all tables in schema app_private from public, anon, authenticated;
grant all on all tables in schema app_private to service_role;

-- Idempotent baseline catalogs --------------------------------------------

insert into public.analytics_event_catalog (
  event_key, schema_version, display_name, description, purpose,
  allowed_surfaces, data_classification
)
select seed.event_key, 1, seed.display_name, seed.description, seed.purpose,
       seed.allowed_surfaces, seed.data_classification
from (values
  ('session.started', 'Session started', 'A new app session began.', 'behavioral', array['customer','operator','kiosk','display','hq']::text[], 'pseudonymous'),
  ('screen.viewed', 'Screen viewed', 'A named application screen became ready.', 'behavioral', array['customer','operator','kiosk','display','hq']::text[], 'pseudonymous'),
  ('interaction.completed', 'Interaction completed', 'A bounded user interaction completed.', 'behavioral', array['customer','operator','kiosk','display','hq']::text[], 'pseudonymous'),
  ('flow.started', 'Flow started', 'A configured user or operational flow began.', 'behavioral', array['customer','operator','kiosk','hq']::text[], 'pseudonymous'),
  ('flow.step_completed', 'Flow step completed', 'A configured flow step completed.', 'behavioral', array['customer','operator','kiosk','hq']::text[], 'pseudonymous'),
  ('flow.completed', 'Flow completed', 'A configured user or operational flow completed.', 'behavioral', array['customer','operator','kiosk','hq']::text[], 'pseudonymous'),
  ('flow.abandoned', 'Flow abandoned', 'A configured flow ended before completion.', 'behavioral', array['customer','operator','kiosk','hq']::text[], 'pseudonymous'),
  ('performance.measured', 'Performance measured', 'A bounded client or API performance measurement.', 'essential', array['customer','operator','kiosk','display','hq']::text[], 'operational'),
  ('error.occurred', 'Error occurred', 'A structured, redacted application error.', 'essential', array['customer','operator','kiosk','display','hq']::text[], 'operational'),
  ('sync.state_changed', 'Sync state changed', 'Realtime or connector synchronization state changed.', 'essential', array['customer','operator','kiosk','display','hq']::text[], 'operational'),
  ('consent.updated', 'Consent updated', 'The pseudonymous analytics consent state changed.', 'essential', array['customer','kiosk','hq']::text[], 'pseudonymous')
) as seed(event_key, display_name, description, purpose, allowed_surfaces, data_classification)
where not exists (
  select 1 from public.analytics_event_catalog existing
  where existing.brand_id is null
    and existing.event_key = seed.event_key
    and existing.schema_version = 1
);

insert into public.connector_registry (
  provider_key, display_name, category, availability, description,
  logo_path, logo_source_url, logo_license, brand_color, documentation_url
)
values
  ('google', 'Google', 'google', 'provider_approval_required', 'Business Profile, Gmail, Drive, Calendar, Analytics, and Ads.', '/integrations/google.svg', 'https://about.google/brand-resource-center/', 'Official Google brand asset', '#4285F4', 'https://developers.google.com/'),
  ('square', 'Square', 'commerce', 'setup_required', 'Payments, orders, catalog, locations, and reconciliation.', '/integrations/square.svg', 'https://squareup.com/us/en/press', 'Official Square brand asset', '#006AFF', 'https://developer.squareup.com/docs'),
  ('stripe', 'Stripe', 'finance', 'setup_required', 'Read-only balances, payouts, invoices, and subscriptions.', '/integrations/stripe.svg', 'https://stripe.com/newsroom/brand-assets', 'Official Stripe brand asset', '#635BFF', 'https://docs.stripe.com/'),
  ('quickbooks', 'QuickBooks Online', 'finance', 'setup_required', 'Read-only accounting reports, invoices, expenses, and vendors.', '/integrations/quickbooks.svg', 'https://www.intuit.com/company/press-room/', 'Official Intuit brand asset', '#2CA01C', 'https://developer.intuit.com/app/developer/qbo/docs/get-started'),
  ('plaid', 'Plaid', 'finance', 'setup_required', 'Read-only Transactions and Balance synchronization.', '/integrations/plaid.svg', 'https://plaid.com/brand/', 'Official Plaid brand asset', '#111111', 'https://plaid.com/docs/'),
  ('slack', 'Slack', 'communications', 'setup_required', 'Selected-channel alerts and operational summaries.', '/integrations/slack.svg', 'https://slack.com/media-kit', 'Official Slack brand asset', '#4A154B', 'https://api.slack.com/docs'),
  ('twilio', 'Twilio', 'communications', 'setup_required', 'Verified SMS delivery and webhook status.', '/integrations/twilio.svg', 'https://www.twilio.com/company/brand', 'Official Twilio brand asset', '#F22F46', 'https://www.twilio.com/docs'),
  ('resend', 'Resend', 'communications', 'setup_required', 'Transactional email and delivery health.', '/integrations/resend.svg', 'https://resend.com/brand', 'Official Resend brand asset', '#000000', 'https://resend.com/docs'),
  ('supabase', 'Supabase', 'platform', 'setup_required', 'Database, Auth, Storage, Realtime, migration, and security health.', '/integrations/supabase.svg', 'https://supabase.com/brand-assets', 'Official Supabase brand asset', '#3ECF8E', 'https://supabase.com/docs'),
  ('vercel', 'Vercel', 'platform', 'setup_required', 'Deployment, domain, cron, environment, and runtime health.', '/integrations/vercel.svg', 'https://vercel.com/geist/brands', 'Official Vercel brand asset', '#000000', 'https://vercel.com/docs'),
  ('sentry', 'Sentry', 'developer', 'setup_required', 'Release and production error health.', '/integrations/sentry.svg', 'https://sentry.io/branding/', 'Official Sentry brand asset', '#362D59', 'https://docs.sentry.io/'),
  ('shopify', 'Shopify', 'commerce', 'coming_soon', 'Commerce catalog and order synchronization candidate.', '/integrations/shopify.svg', 'https://www.shopify.com/brand-assets', 'Official Shopify brand asset', '#95BF47', 'https://shopify.dev/docs'),
  ('sendgrid', 'SendGrid', 'communications', 'coming_soon', 'Email delivery candidate.', '/integrations/sendgrid.svg', 'https://www.twilio.com/company/brand', 'Official Twilio SendGrid brand asset', '#1A82E2', 'https://www.twilio.com/docs/sendgrid'),
  ('cloudflare', 'Cloudflare', 'platform', 'coming_soon', 'Edge, DNS, and security operations candidate.', '/integrations/cloudflare.svg', 'https://www.cloudflare.com/press-kit/', 'Official Cloudflare brand asset', '#F38020', 'https://developers.cloudflare.com/'),
  ('github', 'GitHub', 'developer', 'coming_soon', 'Repository and deployment workflow candidate.', '/integrations/github.svg', 'https://github.com/logos', 'Official GitHub brand asset', '#181717', 'https://docs.github.com/'),
  ('expo', 'Expo', 'distribution', 'coming_soon', 'Mobile build and update health candidate.', '/integrations/expo.svg', 'https://expo.dev/brand', 'Official Expo brand asset', '#000020', 'https://docs.expo.dev/'),
  ('apple', 'Apple', 'distribution', 'coming_soon', 'App Store distribution candidate.', '/integrations/apple.svg', 'https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html', 'Apple identity guidelines', '#000000', 'https://developer.apple.com/documentation/'),
  ('google-play', 'Google Play', 'distribution', 'coming_soon', 'Google Play distribution candidate.', '/integrations/google-play.svg', 'https://about.google/brand-resource-center/', 'Official Google brand asset', '#414141', 'https://developers.google.com/android-publisher'),
  ('checkly', 'Checkly', 'developer', 'coming_soon', 'Synthetic monitoring candidate.', '/integrations/checkly.svg', 'https://www.checklyhq.com/brand/', 'Official Checkly brand asset', '#5E30E5', 'https://www.checklyhq.com/docs/'),
  ('turnstile', 'Cloudflare Turnstile', 'platform', 'coming_soon', 'Abuse prevention candidate.', '/integrations/turnstile.svg', 'https://www.cloudflare.com/press-kit/', 'Official Cloudflare brand asset', '#F38020', 'https://developers.cloudflare.com/turnstile/')
on conflict (provider_key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  availability = excluded.availability,
  description = excluded.description,
  logo_path = excluded.logo_path,
  logo_source_url = excluded.logo_source_url,
  logo_license = excluded.logo_license,
  brand_color = excluded.brand_color,
  documentation_url = excluded.documentation_url,
  updated_at = now();

insert into public.connector_capabilities (
  provider_id, capability_key, display_name, access_mode, oauth_scopes, description
)
select registry.id, seed.capability_key, seed.display_name, seed.access_mode,
       seed.oauth_scopes, seed.description
from (values
  ('google', 'business-profile.read', 'Business Profile', 'read', array['https://www.googleapis.com/auth/business.manage']::text[], 'Performance, reviews, and location mapping.'),
  ('google', 'gmail.compose', 'Gmail', 'write', array['https://www.googleapis.com/auth/gmail.compose']::text[], 'User-reviewed message composition and sending.'),
  ('google', 'drive.files', 'Drive', 'read_write', array['https://www.googleapis.com/auth/drive.file']::text[], 'Picker imports and app-created exports.'),
  ('google', 'calendar.sync', 'Calendar', 'read_write', array['https://www.googleapis.com/auth/calendar.events']::text[], 'Dedicated calendar bidirectional synchronization.'),
  ('google', 'analytics.read', 'Google Analytics', 'read', array['https://www.googleapis.com/auth/analytics.readonly']::text[], 'Read-only GA4 reporting.'),
  ('google', 'ads.read', 'Google Ads', 'read', array['https://www.googleapis.com/auth/adwords']::text[], 'Read-only advertising reporting.'),
  ('square', 'operations.sync', 'Square operations', 'read_write', array[]::text[], 'Orders, catalog, locations, and reconciliation.'),
  ('stripe', 'finance.read', 'Stripe finance', 'read', array[]::text[], 'Balances, payouts, invoices, and subscriptions.'),
  ('quickbooks', 'accounting.read', 'QuickBooks accounting', 'read', array['com.intuit.quickbooks.accounting']::text[], 'Reports, invoices, expenses, and vendors.'),
  ('plaid', 'transactions.read', 'Plaid Transactions', 'read', array['transactions']::text[], 'Incremental transaction synchronization.'),
  ('plaid', 'balance.read', 'Plaid Balance', 'read', array['balance']::text[], 'Current read-only balance.'),
  ('slack', 'alerts.write', 'Slack alerts', 'write', array['chat:write']::text[], 'Selected-channel alerts and summaries.'),
  ('twilio', 'sms.send', 'Twilio SMS', 'write', array[]::text[], 'Verified transactional SMS.'),
  ('resend', 'email.send', 'Resend email', 'write', array[]::text[], 'Transactional email and delivery events.'),
  ('supabase', 'platform.health', 'Supabase health', 'health', array[]::text[], 'Database, Auth, Storage, Realtime, and security health.'),
  ('vercel', 'platform.health', 'Vercel health', 'health', array[]::text[], 'Deployment, domain, cron, environment, and runtime health.'),
  ('sentry', 'errors.read', 'Sentry errors', 'read', array[]::text[], 'Release and unresolved production error reporting.')
) as seed(provider_key, capability_key, display_name, access_mode, oauth_scopes, description)
join public.connector_registry registry on registry.provider_key = seed.provider_key
on conflict (provider_id, capability_key) do update set
  display_name = excluded.display_name,
  access_mode = excluded.access_mode,
  oauth_scopes = excluded.oauth_scopes,
  description = excluded.description,
  updated_at = now();

insert into public.connector_certifications (
  capability_id, environment, status, contract_version, notes
)
select capability.id, 'sandbox', 'not_started', registry.adapter_contract_version,
       'Certification must pass against the provider sandbox before activation.'
from public.connector_capabilities capability
join public.connector_registry registry on registry.id = capability.provider_id
where not exists (
  select 1 from public.connector_certifications certification
  where certification.capability_id = capability.id
    and certification.environment = 'sandbox'
    and certification.contract_version = registry.adapter_contract_version
);

-- Documentation makes data classification and trust boundaries visible in
-- Studio and generated schema references.
comment on schema app_private is
  'Unexposed server orchestration state. Client roles have no usage or object privileges.';
comment on table public.analytics_event_catalog is
  'Versioned allowlist for bounded, non-PII analytics events; null brand_id denotes the platform baseline.';
comment on table public.analytics_events is
  'Server-only, monthly-partitioned pseudonymous raw events retained for 90 days.';
comment on table public.analytics_hourly_rollups is
  'Tenant/location-scoped hourly aggregates safe for authorized HQ analytics.';
comment on table public.analytics_daily_rollups is
  'Tenant/location-scoped daily aggregates retained for long-term reporting.';
comment on table public.analytics_consent_records is
  'Server-only append-only pseudonymous consent history.';
comment on table public.credential_references is
  'Server-only opaque handles and scope metadata; never stores provider access or refresh tokens.';
comment on table public.connector_installations is
  'Tenant connector state with non-secret account labels and certified capability keys.';
comment on table public.connector_audit_events is
  'Append-only tenant audit history with redacted structured detail.';
comment on table app_private.connector_oauth_states is
  'Short-lived hashed OAuth state and opaque PKCE verifier references.';
comment on table app_private.connector_webhook_inbox is
  'Private idempotent webhook intake; verify provider signatures before processing.';
comment on table app_private.connector_outbox is
  'Private durable connector operation queue containing opaque request references only.';
