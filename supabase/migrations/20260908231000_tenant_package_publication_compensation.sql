-- A hosted promotion spans providers that cannot share one database transaction.
-- Preserve the exact database before-image with its publication event so an
-- ambiguous publish response can be compensated without overwriting newer work.

alter table public.tenant_package_publication_events
  add column snapshot_version smallint check (snapshot_version = 1),
  add column previous_package_release_id uuid,
  add column previous_artifact_digest text check (
    previous_artifact_digest is null
    or previous_artifact_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  add column previous_deployment_commit_sha text check (
    previous_deployment_commit_sha is null
    or previous_deployment_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  add column previous_published_at timestamptz,
  add column previous_updated_at timestamptz,
  add column target_previous_status text check (
    target_previous_status is null
    or target_previous_status in ('verified', 'published', 'superseded', 'failed')
  ),
  add column target_previous_deployment_commit_sha text check (
    target_previous_deployment_commit_sha is null
    or target_previous_deployment_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  add column target_previous_published_at timestamptz,
  add column target_previous_superseded_at timestamptz,
  add column target_previous_object_retention_until timestamptz,
  add column target_previous_objects_purged_at timestamptz,
  add column target_previous_purge_started_at timestamptz,
  add column target_previous_purge_claim_id uuid,
  add column target_previous_purge_lease_until timestamptz,
  add constraint tenant_package_publication_events_previous_snapshot_check check (
    num_nonnulls(
      previous_package_release_id, previous_artifact_digest,
      previous_deployment_commit_sha, previous_published_at, previous_updated_at
    ) in (0, 5)
  ),
  add constraint tenant_package_publication_events_previous_release_fkey
    foreign key (previous_package_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  add constraint tenant_package_publication_events_id_brand_key unique (id, brand_id);

create index tenant_package_publication_events_previous_release_idx
  on public.tenant_package_publication_events (previous_package_release_id, brand_id);
revoke insert, update, delete, truncate, references, trigger
  on table public.tenant_package_publication_events from service_role;
revoke all on sequence public.tenant_package_publication_events_id_seq
  from public, anon, authenticated, service_role;

create table public.tenant_package_publication_compensations (
  id bigint generated always as identity primary key,
  publication_event_id bigint not null,
  brand_id uuid not null references public.brands (id) on delete restrict,
  failed_release_id uuid not null,
  restored_release_id uuid,
  failed_deployment_commit_sha text not null check (
    failed_deployment_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  restored_deployment_commit_sha text check (
    restored_deployment_commit_sha is null
    or restored_deployment_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  rollback_canary_reference text not null check (
    rollback_canary_reference
      ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
  ),
  rollback_approval_reference text not null check (
    rollback_approval_reference
      ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
  ),
  compensated_at timestamptz not null default now(),
  constraint tenant_package_publication_compensations_event_key
    unique (publication_event_id),
  constraint tenant_package_publication_compensations_id_brand_key
    unique (id, brand_id),
  foreign key (publication_event_id, brand_id)
    references public.tenant_package_publication_events (id, brand_id) on delete restrict,
  foreign key (failed_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  foreign key (restored_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  check (
    (restored_release_id is null and restored_deployment_commit_sha is null)
    or (restored_release_id is not null and restored_deployment_commit_sha is not null)
  )
);

alter table public.tenant_package_publication_compensations enable row level security;
create index tenant_package_publication_compensations_event_brand_idx
  on public.tenant_package_publication_compensations (publication_event_id, brand_id);
create index tenant_package_publication_compensations_brand_idx
  on public.tenant_package_publication_compensations (brand_id);
create index tenant_package_publication_compensations_failed_release_idx
  on public.tenant_package_publication_compensations (failed_release_id, brand_id);
create index tenant_package_publication_compensations_restored_release_idx
  on public.tenant_package_publication_compensations (restored_release_id, brand_id);
revoke all on table public.tenant_package_publication_compensations
  from public, anon, authenticated, service_role;
grant select on table public.tenant_package_publication_compensations to service_role;
revoke all on sequence public.tenant_package_publication_compensations_id_seq
  from public, anon, authenticated, service_role;
create trigger tenant_package_publication_compensations_immutable
before update or delete on public.tenant_package_publication_compensations
for each row execute function app_private.reject_tenant_package_event_mutation();

create table public.tenant_package_publication_compensation_confirmations (
  id bigint generated always as identity primary key,
  compensation_id bigint not null unique,
  brand_id uuid not null references public.brands (id) on delete restrict,
  completed_at timestamptz not null default now(),
  foreign key (compensation_id, brand_id)
    references public.tenant_package_publication_compensations (id, brand_id)
    on delete restrict
);
alter table public.tenant_package_publication_compensation_confirmations
  enable row level security;
create index tenant_package_compensation_confirmations_comp_brand_idx
  on public.tenant_package_publication_compensation_confirmations
    (compensation_id, brand_id);
create index tenant_package_compensation_confirmations_brand_idx
  on public.tenant_package_publication_compensation_confirmations (brand_id);
revoke all on table public.tenant_package_publication_compensation_confirmations
  from public, anon, authenticated, service_role;
grant select on table public.tenant_package_publication_compensation_confirmations
  to service_role;
revoke all on sequence
  public.tenant_package_publication_compensation_confirmations_id_seq
  from public, anon, authenticated, service_role;
create trigger tenant_package_publication_compensation_confirmations_immutable
before update or delete on public.tenant_package_publication_compensation_confirmations
for each row execute function app_private.reject_tenant_package_event_mutation();

create or replace function public.publish_tenant_package(
  p_brand_id uuid,
  p_release_key text,
  p_artifact_digest text,
  p_commit_sha text,
  p_canary_reference text,
  p_approval_reference text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  release_row public.tenant_package_releases%rowtype;
  previous_publication public.tenant_package_publications%rowtype;
  previous_release public.tenant_package_releases%rowtype;
  promotion_time timestamptz := now();
  existing_promotion_time timestamptz;
begin
  if p_brand_id is null or p_release_key is null or p_artifact_digest is null
     or p_commit_sha is null or p_canary_reference is null or p_approval_reference is null
     or p_release_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'
     or p_artifact_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_canary_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
     or p_approval_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$' then
    raise exception using errcode = '22023', message = 'tenant_package_evidence_invalid';
  end if;

  perform 1 from public.brands brand where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_release_mismatch';
  end if;

  select * into previous_publication
  from public.tenant_package_publications publication
  where publication.brand_id = p_brand_id for update;

  select * into release_row from public.tenant_package_releases release
  where release.brand_id = p_brand_id and release.release_key = p_release_key for update;
  if not found or release_row.status not in ('verified', 'published', 'superseded')
     or release_row.artifact_digest <> p_artifact_digest
     or (release_row.status = 'superseded' and (
       release_row.objects_purged_at is not null
       or release_row.purge_started_at is not null
       or release_row.object_retention_until <= statement_timestamp()
       or not exists (
         select 1 from storage.objects object_row
         where object_row.bucket_id = 'tenant-packages'
           and object_row.name = release_row.archive_object_path
       )
       or exists (
         select 1 from public.tenant_package_files file
         where file.package_release_id = release_row.id and (
           not exists (
             select 1 from storage.objects object_row
             where object_row.bucket_id = 'tenant-packages'
               and object_row.name = file.object_path
           ) or (file.preview_object_path is not null and not exists (
             select 1 from storage.objects object_row
             where object_row.bucket_id = 'tenant-packages'
               and object_row.name = file.preview_object_path
           ))
         )
       )
     )) then
    raise exception using errcode = '23514', message = 'tenant_package_release_mismatch';
  end if;

  if previous_publication.brand_id is null then
    if exists (
      select 1 from public.tenant_package_releases published_release
      where published_release.brand_id = p_brand_id
        and published_release.status = 'published'
    ) then
      raise exception using errcode = '23514', message = 'tenant_package_release_mismatch';
    end if;
  else
    select * into previous_release from public.tenant_package_releases prior_release
    where prior_release.id = previous_publication.current_release_id
      and prior_release.brand_id = p_brand_id for update;
    if not found or previous_release.status <> 'published'
       or previous_release.artifact_digest <> previous_publication.artifact_digest
       or previous_release.deployment_commit_sha
         <> previous_publication.deployment_commit_sha
       or previous_release.published_at <> previous_publication.published_at
       or previous_release.superseded_at is not null
       or previous_release.object_retention_until is not null
       or previous_release.objects_purged_at is not null
       or previous_release.purge_started_at is not null
       or previous_release.purge_claim_id is not null
       or previous_release.purge_lease_until is not null then
      raise exception using errcode = '23514', message = 'tenant_package_release_mismatch';
    end if;
  end if;

  insert into public.tenant_package_publication_events (
    brand_id, package_release_id, artifact_digest, deployment_commit_sha,
    canary_reference, approval_reference, promoted_at, snapshot_version,
    previous_package_release_id, previous_artifact_digest,
    previous_deployment_commit_sha, previous_published_at, previous_updated_at,
    target_previous_status, target_previous_deployment_commit_sha,
    target_previous_published_at, target_previous_superseded_at,
    target_previous_object_retention_until, target_previous_objects_purged_at,
    target_previous_purge_started_at, target_previous_purge_claim_id,
    target_previous_purge_lease_until
  ) values (
    p_brand_id, release_row.id, p_artifact_digest, p_commit_sha,
    p_canary_reference, p_approval_reference, promotion_time, 1,
    previous_publication.current_release_id, previous_publication.artifact_digest,
    previous_publication.deployment_commit_sha, previous_publication.published_at,
    previous_publication.updated_at,
    release_row.status, release_row.deployment_commit_sha,
    release_row.published_at, release_row.superseded_at,
    release_row.object_retention_until, release_row.objects_purged_at,
    release_row.purge_started_at, release_row.purge_claim_id,
    release_row.purge_lease_until
  ) on conflict (
    brand_id, package_release_id, deployment_commit_sha,
    canary_reference, approval_reference
  ) do nothing returning promoted_at into promotion_time;

  if not found then
    select publication_event.promoted_at into existing_promotion_time
    from public.tenant_package_publication_events publication_event
    where publication_event.brand_id = p_brand_id
      and publication_event.package_release_id = release_row.id
      and publication_event.deployment_commit_sha = p_commit_sha
      and publication_event.canary_reference = p_canary_reference
      and publication_event.approval_reference = p_approval_reference;
    if exists (
      select 1 from public.tenant_package_publications publication
      where publication.brand_id = p_brand_id
        and publication.current_release_id = release_row.id
        and publication.artifact_digest = p_artifact_digest
        and publication.deployment_commit_sha = p_commit_sha
        and publication.published_at = existing_promotion_time
    ) then
      return release_row.id;
    end if;
    raise exception using errcode = '23514', message = 'tenant_package_evidence_replayed';
  end if;

  update public.tenant_package_releases release set
    status = 'superseded', superseded_at = promotion_time,
    object_retention_until = promotion_time + interval '1 year'
  where release.brand_id = p_brand_id and release.status = 'published'
    and release.id <> release_row.id;
  update public.tenant_package_releases release set
    status = 'published', published_at = promotion_time,
    deployment_commit_sha = p_commit_sha,
    superseded_at = null, object_retention_until = null,
    objects_purged_at = null, purge_started_at = null,
    purge_claim_id = null, purge_lease_until = null
  where release.id = release_row.id;
  insert into public.tenant_package_publications (
    brand_id, current_release_id, artifact_digest, deployment_commit_sha, published_at
  ) values (p_brand_id, release_row.id, p_artifact_digest, p_commit_sha, promotion_time)
  on conflict (brand_id) do update set
    current_release_id = excluded.current_release_id,
    artifact_digest = excluded.artifact_digest,
    deployment_commit_sha = excluded.deployment_commit_sha,
    published_at = excluded.published_at,
    updated_at = now();
  perform public.record_organization_readiness(
    p_brand_id, 'release_approval', true,
    jsonb_build_object(
      'commitSha', p_commit_sha,
      'artifactDigest', p_artifact_digest,
      'providerReference', p_approval_reference,
      'canaryReference', p_canary_reference
    )
  );
  return release_row.id;
end $$;

revoke all on function public.publish_tenant_package(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.publish_tenant_package(uuid, text, text, text, text, text)
  to service_role;

create function public.publish_tenant_package_if_current(
  p_brand_id uuid,
  p_release_key text,
  p_artifact_digest text,
  p_commit_sha text,
  p_canary_reference text,
  p_approval_reference text,
  p_previous_release_id uuid,
  p_previous_artifact_digest text,
  p_previous_commit_sha text,
  p_previous_published_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_publication public.tenant_package_publications%rowtype;
  expected_previous_count integer;
begin
  expected_previous_count := num_nonnulls(
    p_previous_release_id, p_previous_artifact_digest,
    p_previous_commit_sha, p_previous_published_at
  );
  if p_brand_id is null or expected_previous_count not in (0, 4)
     or (p_previous_artifact_digest is not null
       and p_previous_artifact_digest !~ '^sha256:[0-9a-f]{64}$')
     or (p_previous_commit_sha is not null
       and p_previous_commit_sha !~ '^[0-9a-f]{40}$') then
    raise exception using
      errcode = '22023', message = 'tenant_package_publication_expectation_invalid';
  end if;

  perform 1 from public.brands brand where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_publication_conflict';
  end if;
  select * into current_publication
  from public.tenant_package_publications publication
  where publication.brand_id = p_brand_id for update;
  if (expected_previous_count = 0 and current_publication.brand_id is not null)
     or (expected_previous_count = 4 and (
       current_publication.brand_id is null
       or current_publication.current_release_id <> p_previous_release_id
       or current_publication.artifact_digest <> p_previous_artifact_digest
       or current_publication.deployment_commit_sha <> p_previous_commit_sha
       or current_publication.published_at <> p_previous_published_at
     )) then
    raise exception using errcode = '23514', message = 'tenant_package_publication_conflict';
  end if;

  return public.publish_tenant_package(
    p_brand_id, p_release_key, p_artifact_digest, p_commit_sha,
    p_canary_reference, p_approval_reference
  );
end $$;
revoke all on function public.publish_tenant_package_if_current(
  uuid, text, text, text, text, text, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_tenant_package_if_current(
  uuid, text, text, text, text, text, uuid, text, text, timestamptz
) to service_role;

create function public.compensate_tenant_package_publication(
  p_brand_id uuid,
  p_release_id uuid,
  p_commit_sha text,
  p_canary_reference text,
  p_approval_reference text,
  p_rollback_canary_reference text,
  p_rollback_approval_reference text,
  p_previous_release_id uuid,
  p_previous_artifact_digest text,
  p_previous_commit_sha text,
  p_previous_published_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare
  publication_event public.tenant_package_publication_events%rowtype;
  compensation public.tenant_package_publication_compensations%rowtype;
  current_publication public.tenant_package_publications%rowtype;
  target_release public.tenant_package_releases%rowtype;
  previous_release public.tenant_package_releases%rowtype;
  compensation_id bigint;
  expected_previous_count integer;
begin
  expected_previous_count := num_nonnulls(
    p_previous_release_id, p_previous_artifact_digest,
    p_previous_commit_sha, p_previous_published_at
  );
  if p_brand_id is null or p_release_id is null or p_commit_sha is null
     or p_canary_reference is null or p_approval_reference is null
     or p_rollback_canary_reference is null or p_rollback_approval_reference is null
     or expected_previous_count not in (0, 4)
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or (p_previous_artifact_digest is not null
       and p_previous_artifact_digest !~ '^sha256:[0-9a-f]{64}$')
     or (p_previous_commit_sha is not null
       and p_previous_commit_sha !~ '^[0-9a-f]{40}$')
     or p_canary_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
     or p_approval_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
     or p_rollback_canary_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
     or p_rollback_approval_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$' then
    raise exception using errcode = '22023', message = 'tenant_package_compensation_invalid';
  end if;

  perform 1 from public.brands brand where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  select * into current_publication
  from public.tenant_package_publications current_pointer
  where current_pointer.brand_id = p_brand_id for update;

  select * into publication_event
  from public.tenant_package_publication_events event_row
  where event_row.brand_id = p_brand_id
    and event_row.package_release_id = p_release_id
    and event_row.deployment_commit_sha = p_commit_sha
    and event_row.canary_reference = p_canary_reference
    and event_row.approval_reference = p_approval_reference;

  if publication_event.id is null then
    if (expected_previous_count = 0 and current_publication.brand_id is null)
       or (expected_previous_count = 4
         and current_publication.current_release_id = p_previous_release_id
         and current_publication.artifact_digest = p_previous_artifact_digest
         and current_publication.deployment_commit_sha = p_previous_commit_sha
         and current_publication.published_at = p_previous_published_at) then
      return 'not_committed';
    end if;
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  if publication_event.snapshot_version is distinct from 1
     or publication_event.previous_package_release_id is distinct from p_previous_release_id
     or publication_event.previous_artifact_digest is distinct from p_previous_artifact_digest
     or publication_event.previous_deployment_commit_sha is distinct from p_previous_commit_sha
     or publication_event.previous_published_at is distinct from p_previous_published_at then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  select * into compensation
  from public.tenant_package_publication_compensations compensation_row
  where compensation_row.publication_event_id = publication_event.id;

  select * into target_release from public.tenant_package_releases release
  where release.id = p_release_id and release.brand_id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  if p_previous_release_id is not null and p_previous_release_id <> p_release_id then
    select * into previous_release from public.tenant_package_releases release
    where release.id = p_previous_release_id and release.brand_id = p_brand_id for update;
    if not found then
      raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
    end if;
  elsif p_previous_release_id = p_release_id then
    previous_release := target_release;
  end if;

  if compensation.id is not null then
    if compensation.brand_id <> p_brand_id
       or compensation.failed_release_id <> p_release_id
       or compensation.restored_release_id is distinct from p_previous_release_id
       or compensation.failed_deployment_commit_sha <> p_commit_sha
       or compensation.restored_deployment_commit_sha
         is distinct from p_previous_commit_sha
       or compensation.rollback_canary_reference <> p_rollback_canary_reference
       or compensation.rollback_approval_reference <> p_rollback_approval_reference
       or (p_previous_release_id is null and current_publication.brand_id is not null)
       or (p_previous_release_id is not null and (
         current_publication.brand_id is null
         or current_publication.current_release_id <> p_previous_release_id
         or current_publication.artifact_digest <> p_previous_artifact_digest
         or current_publication.deployment_commit_sha <> p_previous_commit_sha
         or current_publication.published_at <> p_previous_published_at
       ))
       or target_release.status is distinct from publication_event.target_previous_status
       or target_release.deployment_commit_sha
         is distinct from publication_event.target_previous_deployment_commit_sha
       or target_release.published_at
         is distinct from publication_event.target_previous_published_at
       or target_release.superseded_at
         is distinct from publication_event.target_previous_superseded_at
       or target_release.object_retention_until
         is distinct from publication_event.target_previous_object_retention_until
       or target_release.objects_purged_at
         is distinct from publication_event.target_previous_objects_purged_at
       or target_release.purge_started_at
         is distinct from publication_event.target_previous_purge_started_at
       or target_release.purge_claim_id
         is distinct from publication_event.target_previous_purge_claim_id
       or target_release.purge_lease_until
         is distinct from publication_event.target_previous_purge_lease_until then
      raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
    end if;
    return 'compensated';
  end if;

  if current_publication.brand_id is null
     or current_publication.current_release_id <> p_release_id
     or current_publication.artifact_digest <> publication_event.artifact_digest
     or current_publication.deployment_commit_sha <> p_commit_sha
     or current_publication.published_at <> publication_event.promoted_at
     or target_release.status <> 'published'
     or target_release.artifact_digest <> publication_event.artifact_digest
     or target_release.deployment_commit_sha <> p_commit_sha
     or target_release.published_at <> publication_event.promoted_at
     or target_release.superseded_at is not null
     or target_release.object_retention_until is not null
     or target_release.objects_purged_at is not null
     or target_release.purge_started_at is not null
     or target_release.purge_claim_id is not null
     or target_release.purge_lease_until is not null then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  if (p_previous_release_id is null
       and publication_event.target_previous_status = 'published')
     or (p_previous_release_id = p_release_id
       and publication_event.target_previous_status <> 'published')
     or (p_previous_release_id is not null and p_previous_release_id <> p_release_id
       and publication_event.target_previous_status = 'published') then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  if p_previous_release_id is not null and p_previous_release_id <> p_release_id then
    if previous_release.status <> 'superseded'
       or previous_release.artifact_digest <> p_previous_artifact_digest
       or previous_release.deployment_commit_sha <> p_previous_commit_sha
       or previous_release.published_at <> p_previous_published_at
       or previous_release.objects_purged_at is not null
       or previous_release.purge_started_at is not null
       or previous_release.purge_claim_id is not null
       or previous_release.purge_lease_until is not null
       or not exists (
         select 1 from storage.objects object_row
         where object_row.bucket_id = 'tenant-packages'
           and object_row.name = previous_release.archive_object_path
       )
       or exists (
         select 1 from public.tenant_package_files file
         where file.package_release_id = previous_release.id and (
           not exists (
             select 1 from storage.objects object_row
             where object_row.bucket_id = 'tenant-packages'
               and object_row.name = file.object_path
           ) or (file.preview_object_path is not null and not exists (
             select 1 from storage.objects object_row
             where object_row.bucket_id = 'tenant-packages'
               and object_row.name = file.preview_object_path
           ))
         )
       ) then
      raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
    end if;
  end if;

  update public.tenant_package_releases release set
    status = publication_event.target_previous_status,
    deployment_commit_sha = publication_event.target_previous_deployment_commit_sha,
    published_at = publication_event.target_previous_published_at,
    superseded_at = publication_event.target_previous_superseded_at,
    object_retention_until = publication_event.target_previous_object_retention_until,
    objects_purged_at = publication_event.target_previous_objects_purged_at,
    purge_started_at = publication_event.target_previous_purge_started_at,
    purge_claim_id = publication_event.target_previous_purge_claim_id,
    purge_lease_until = publication_event.target_previous_purge_lease_until
  where release.id = p_release_id;

  if p_previous_release_id is null then
    delete from public.tenant_package_publications publication
    where publication.brand_id = p_brand_id;
  else
    if p_previous_release_id <> p_release_id then
      update public.tenant_package_releases release set
        status = 'published', deployment_commit_sha = p_previous_commit_sha,
        published_at = p_previous_published_at, superseded_at = null,
        object_retention_until = null, objects_purged_at = null,
        purge_started_at = null, purge_claim_id = null, purge_lease_until = null
      where release.id = p_previous_release_id;
    end if;
    update public.tenant_package_publications publication set
      current_release_id = p_previous_release_id,
      artifact_digest = p_previous_artifact_digest,
      deployment_commit_sha = p_previous_commit_sha,
      published_at = p_previous_published_at,
      updated_at = publication_event.previous_updated_at
    where publication.brand_id = p_brand_id;
  end if;

  insert into public.tenant_package_publication_compensations (
    publication_event_id, brand_id, failed_release_id, restored_release_id,
    failed_deployment_commit_sha, restored_deployment_commit_sha,
    rollback_canary_reference, rollback_approval_reference
  ) values (
    publication_event.id, p_brand_id, p_release_id, p_previous_release_id,
    p_commit_sha, p_previous_commit_sha,
    p_rollback_canary_reference, p_rollback_approval_reference
  ) returning id into compensation_id;

  perform public.record_organization_readiness(
    p_brand_id, 'release_approval', false,
    jsonb_build_object(
      'commitSha', p_commit_sha,
      'artifactDigest', publication_event.artifact_digest,
      'providerReference', p_rollback_approval_reference,
      'canaryReference', p_rollback_canary_reference,
      'compensationId', compensation_id,
      'compensatedPublicationEventId', publication_event.id,
      'restoredReleaseId', p_previous_release_id,
      'restoredCommitSha', p_previous_commit_sha,
      'providerRollbackPending', true
    )
  );
  return 'compensated';
end $$;

revoke all on function public.compensate_tenant_package_publication(
  uuid, uuid, text, text, text, text, text, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.compensate_tenant_package_publication(
  uuid, uuid, text, text, text, text, text, uuid, text, text, timestamptz
) to service_role;

create function public.confirm_tenant_package_publication_compensation(
  p_brand_id uuid,
  p_release_id uuid,
  p_commit_sha text,
  p_canary_reference text,
  p_approval_reference text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  publication_event public.tenant_package_publication_events%rowtype;
  compensation public.tenant_package_publication_compensations%rowtype;
  current_publication public.tenant_package_publications%rowtype;
  target_release public.tenant_package_releases%rowtype;
  confirmation_id bigint;
begin
  if p_brand_id is null or p_release_id is null
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_canary_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
     or p_approval_reference
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$' then
    raise exception using
      errcode = '22023', message = 'tenant_package_compensation_invalid';
  end if;

  perform 1 from public.brands brand where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into publication_event
  from public.tenant_package_publication_events event_row
  where event_row.brand_id = p_brand_id
    and event_row.package_release_id = p_release_id
    and event_row.deployment_commit_sha = p_commit_sha
    and event_row.canary_reference = p_canary_reference
    and event_row.approval_reference = p_approval_reference;
  if not found or publication_event.snapshot_version is distinct from 1 then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into compensation
  from public.tenant_package_publication_compensations compensation_row
  where compensation_row.publication_event_id = publication_event.id;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into current_publication
  from public.tenant_package_publications publication
  where publication.brand_id = p_brand_id for update;
  select * into target_release from public.tenant_package_releases release
  where release.id = p_release_id and release.brand_id = p_brand_id for update;
  if not found
     or (publication_event.previous_package_release_id is null
       and current_publication.brand_id is not null)
     or (publication_event.previous_package_release_id is not null and (
       current_publication.brand_id is null
       or current_publication.current_release_id
         <> publication_event.previous_package_release_id
       or current_publication.artifact_digest
         <> publication_event.previous_artifact_digest
       or current_publication.deployment_commit_sha
         <> publication_event.previous_deployment_commit_sha
       or current_publication.published_at <> publication_event.previous_published_at
     ))
     or target_release.status is distinct from publication_event.target_previous_status
     or target_release.deployment_commit_sha
       is distinct from publication_event.target_previous_deployment_commit_sha
     or target_release.published_at
       is distinct from publication_event.target_previous_published_at
     or target_release.superseded_at
       is distinct from publication_event.target_previous_superseded_at
     or target_release.object_retention_until
       is distinct from publication_event.target_previous_object_retention_until
     or target_release.objects_purged_at
       is distinct from publication_event.target_previous_objects_purged_at
     or target_release.purge_started_at
       is distinct from publication_event.target_previous_purge_started_at
     or target_release.purge_claim_id
       is distinct from publication_event.target_previous_purge_claim_id
     or target_release.purge_lease_until
       is distinct from publication_event.target_previous_purge_lease_until then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  insert into public.tenant_package_publication_compensation_confirmations (
    compensation_id, brand_id
  ) values (compensation.id, p_brand_id)
  on conflict (compensation_id) do nothing
  returning id into confirmation_id;
  if not found then
    select confirmation.id into confirmation_id
    from public.tenant_package_publication_compensation_confirmations confirmation
    where confirmation.compensation_id = compensation.id;
  end if;

  perform public.record_organization_readiness(
    p_brand_id, 'release_approval',
    publication_event.previous_package_release_id is not null,
    jsonb_build_object(
      'commitSha', coalesce(
        publication_event.previous_deployment_commit_sha, p_commit_sha
      ),
      'artifactDigest', coalesce(
        publication_event.previous_artifact_digest, publication_event.artifact_digest
      ),
      'providerReference', compensation.rollback_approval_reference,
      'canaryReference', compensation.rollback_canary_reference,
      'compensationId', compensation.id,
      'compensationConfirmationId', confirmation_id,
      'compensatedPublicationEventId', publication_event.id,
      'providerRollbackCompleted', true
    )
  );
  return 'confirmed';
end $$;
revoke all on function public.confirm_tenant_package_publication_compensation(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_tenant_package_publication_compensation(
  uuid, uuid, text, text, text
) to service_role;

create function app.assert_tenant_package_publication_compensation()
returns void language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_tenant_package_upload_sessions();
  if pg_catalog.to_regclass(
       'public.tenant_package_publication_compensations'
     ) is null
     or pg_catalog.to_regclass(
       'public.tenant_package_publication_compensation_confirmations'
     ) is null
     or not exists (
       select 1 from pg_catalog.pg_class relation
       where relation.oid =
         'public.tenant_package_publication_compensations'::regclass
         and relation.relrowsecurity
     )
     or pg_catalog.to_regprocedure(
       'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.publish_tenant_package_if_current(uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.confirm_tenant_package_publication_compensation(uuid,uuid,text,text,text)'
     ) is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'tenant_package_publication_events'
         and column_name = 'snapshot_version'
     )
     or not exists (
       select 1 from pg_catalog.pg_indexes
       where schemaname = 'public'
         and tablename = 'tenant_package_publication_compensations'
         and indexname = 'tenant_package_publication_compensations_event_brand_idx'
     )
     or not exists (
       select 1 from pg_catalog.pg_indexes
       where schemaname = 'public'
         and tablename = 'tenant_package_publication_compensations'
         and indexname = 'tenant_package_publication_compensations_brand_idx'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.tenant_package_publication_compensations'::regclass
         and trigger_row.tgname = 'tenant_package_publication_compensations_immutable'
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.tenant_package_publication_compensation_confirmations'::regclass
         and trigger_row.tgname =
           'tenant_package_publication_compensation_confirmations_immutable'
         and not trigger_row.tgisinternal
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
       'execute'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
       'execute'
     ) then
    raise exception 'tenant package publication compensation contract is incomplete';
  end if;
end $$;
revoke all on function app.assert_tenant_package_publication_compensation()
  from public, anon, authenticated;
grant execute on function app.assert_tenant_package_publication_compensation()
  to service_role;

select app.register_release(
  '20260908231000',
  'compensate ambiguous tenant package publication atomically',
  'app.assert_tenant_package_publication_compensation()'::regprocedure
);
