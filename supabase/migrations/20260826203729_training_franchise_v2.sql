-- Franchise-ready training contract v2.
-- Releases stay immutable JSON contracts; templates provide a reusable,
-- versioned starting point for every industry and tenant overlay.

create table public.training_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  version integer not null check (version > 0),
  industry text not null check (length(btrim(industry)) between 2 and 120),
  locale text not null default 'en-US' check (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  status text not null default 'published' check (status in ('draft', 'published', 'retired')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_key, version),
  unique (id, template_key)
);

create index training_templates_lookup_idx
  on public.training_templates (template_key, status, version desc);

alter table public.training_releases
  add column if not exists template_key text,
  add column if not exists template_version integer,
  add column if not exists base_release_id uuid;

alter table public.training_releases
  add constraint training_releases_template_key_check
    check (template_key is null or template_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  add constraint training_releases_template_version_check
    check (template_version is null or template_version > 0);

create index training_releases_template_idx
  on public.training_releases (brand_id, template_key, template_version)
  where template_key is not null;

alter table public.training_templates enable row level security;

create policy training_templates_select on public.training_templates
  for select to authenticated
  using (status = 'published' or app.is_platform_admin());

revoke all on table public.training_templates from anon, authenticated;
grant select on table public.training_templates to authenticated;
grant all on table public.training_templates to service_role;

create trigger training_templates_touch before update on public.training_templates
  for each row execute function app.touch_updated_at();

-- A release event is the synchronization boundary for every operator build.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'training_releases'
  ) then
    alter publication supabase_realtime add table public.training_releases;
  end if;
end $$;

create or replace function public.publish_training_release(
  target_brand uuid,
  target_run uuid,
  release_manifest jsonb,
  release_answer_key jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  next_version integer;
  release_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_brand::text, 0));
  if not exists (
    select 1 from public.training_bootstrap_runs
    where id = target_run and brand_id = target_brand
  ) then
    raise exception 'training bootstrap run does not belong to tenant';
  end if;
  select id into release_id from public.training_releases
  where brand_id = target_brand and bootstrap_run_id = target_run;
  if release_id is not null then return release_id; end if;
  select coalesce(max(version), 0) + 1 into next_version
  from public.training_releases where brand_id = target_brand;
  update public.training_releases
    set status = 'retired', updated_at = now()
    where brand_id = target_brand and status = 'published';
  insert into public.training_releases (
    brand_id, bootstrap_run_id, version, status, manifest, answer_key,
    template_key, template_version, validated_at, published_at
  ) values (
    target_brand, target_run, next_version, 'published', release_manifest, release_answer_key,
    nullif(release_manifest->'tenant'->>'templateKey', ''),
    nullif(release_manifest->'tenant'->>'templateVersion', '')::integer,
    now(), now()
  ) returning id into release_id;
  return release_id;
end $$;

revoke all on function public.publish_training_release(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_training_release(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.publish_manual_training_release(
  target_brand uuid,
  target_release uuid,
  target_editor uuid,
  expected_updated_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected public.training_releases%rowtype;
  core_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_brand::text, 0));

  if not exists (
    select 1 from public.brand_users member
    where member.id = target_editor and member.brand_id = target_brand
      and member.role in ('brand_owner', 'platform_admin')
  ) then
    raise exception using errcode = '42501', message = 'training_editor_not_authorized';
  end if;

  select * into selected
  from public.training_releases
  where id = target_release and brand_id = target_brand and status = 'draft'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'training_draft_not_found';
  end if;
  if date_trunc('milliseconds', selected.updated_at)
     is distinct from date_trunc('milliseconds', expected_updated_at) then
    raise exception using errcode = '40001', message = 'training_draft_stale';
  end if;

  select count(distinct module->>'trackKey') into core_count
  from jsonb_array_elements(selected.manifest->'modules') module
  where module->>'trackKey' in ('knowledge', 'skills', 'service', 'safety', 'operations');
  if jsonb_typeof(selected.manifest) <> 'object'
     or selected.manifest->>'schemaVersion' not in ('2')
     or jsonb_typeof(selected.manifest->'modules') <> 'array'
     or jsonb_array_length(selected.manifest->'modules') < 5
     or jsonb_array_length(selected.manifest->'modules') > 16
     or core_count <> 5
     or jsonb_typeof(selected.manifest->'sources') <> 'array'
     or jsonb_array_length(selected.manifest->'sources') < 3
     or jsonb_array_length(selected.manifest->'sources') > 12
     or jsonb_typeof(selected.answer_key) <> 'object' then
    raise exception using errcode = '22023', message = 'training_manifest_not_publishable';
  end if;

  update public.training_releases
  set status = 'retired', updated_at = now()
  where brand_id = target_brand and status = 'published';

  update public.training_releases
  set status = 'published', validated_at = now(), published_at = now(),
      updated_at = now(), updated_by = target_editor
  where id = target_release and brand_id = target_brand;
  return target_release;
end $$;

revoke all on function public.publish_manual_training_release(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_manual_training_release(
  uuid, uuid, uuid, timestamptz
) to service_role;

comment on table public.training_templates is
  'Versioned franchise curriculum templates. Tenant releases resolve a template with profile overlays and research.';
comment on column public.training_releases.manifest is
  'Immutable resolved v2 curriculum; answer-free for authenticated staff reads.';
