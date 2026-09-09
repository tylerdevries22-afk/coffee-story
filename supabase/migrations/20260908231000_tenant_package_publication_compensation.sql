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

-- Service workers observe publication state and mutate it only through the
-- audited SECURITY DEFINER functions below.
revoke all on table
  public.tenant_package_releases,
  public.tenant_package_files,
  public.tenant_package_publications,
  public.organization_readiness_checks
from service_role;
grant select on table
  public.tenant_package_releases,
  public.tenant_package_files,
  public.tenant_package_publications,
  public.organization_readiness_checks
to service_role;

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
     or release_row.objects_purged_at is not null
     or release_row.purge_started_at is not null
     or release_row.purge_claim_id is not null
     or release_row.purge_lease_until is not null
     or release_row.purge_reason is not null
     or release_row.purge_blocked_at is not null
     or release_row.purge_blocked_reason is not null
     or (release_row.status = 'superseded' and (
       release_row.object_retention_until <= statement_timestamp()
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
       or previous_release.purge_lease_until is not null
       or previous_release.purge_reason is not null
       or previous_release.purge_blocked_at is not null
       or previous_release.purge_blocked_reason is not null then
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
    purge_claim_id = null, purge_lease_until = null,
    purge_reason = null, purge_blocked_at = null, purge_blocked_reason = null
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
  from public, anon, authenticated, service_role;

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
  if exists (
    select 1
    from public.tenant_package_publication_compensations compensation
    left join public.tenant_package_publication_compensation_confirmations confirmation
      on confirmation.compensation_id = compensation.id
    where compensation.brand_id = p_brand_id
      and confirmation.id is null
  ) then
    raise exception using
      errcode = '23514', message = 'tenant_package_publication_conflict';
  end if;
  if (expected_previous_count = 0 and current_publication.brand_id is not null)
     or (expected_previous_count = 4 and (
       current_publication.brand_id is null
       or current_publication.current_release_id is distinct from p_previous_release_id
       or current_publication.artifact_digest is distinct from p_previous_artifact_digest
       or current_publication.deployment_commit_sha is distinct from p_previous_commit_sha
       or current_publication.published_at is distinct from p_previous_published_at
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
  artifact_readiness public.organization_readiness_checks%rowtype;
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
    if (
      (expected_previous_count = 0 and current_publication.brand_id is null)
      or (expected_previous_count = 4
        and current_publication.current_release_id
          is not distinct from p_previous_release_id
        and current_publication.artifact_digest
          is not distinct from p_previous_artifact_digest
        and current_publication.deployment_commit_sha
          is not distinct from p_previous_commit_sha
        and current_publication.published_at
          is not distinct from p_previous_published_at)
    ) and not exists (
      select 1
      from public.tenant_package_publication_compensations compensation_row
      left join public.tenant_package_publication_compensation_confirmations confirmation
        on confirmation.compensation_id = compensation_row.id
      where compensation_row.brand_id = p_brand_id
        and confirmation.id is null
    ) then
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

  if exists (
    select 1 from public.tenant_package_publication_events later_event
    where later_event.brand_id = p_brand_id
      and later_event.id > publication_event.id
  ) then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  select * into compensation
  from public.tenant_package_publication_compensations compensation_row
  where compensation_row.publication_event_id = publication_event.id;

  select * into artifact_readiness
  from public.organization_readiness_checks readiness
  where readiness.brand_id = p_brand_id
    and readiness.check_key = 'tenant_artifacts'
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

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
    if compensation.brand_id is distinct from p_brand_id
       or compensation.failed_release_id is distinct from p_release_id
       or compensation.restored_release_id is distinct from p_previous_release_id
       or compensation.failed_deployment_commit_sha is distinct from p_commit_sha
       or compensation.restored_deployment_commit_sha
         is distinct from p_previous_commit_sha
       or compensation.rollback_canary_reference
         is distinct from p_rollback_canary_reference
       or compensation.rollback_approval_reference
         is distinct from p_rollback_approval_reference
       or artifact_readiness.status is distinct from 'passed'
       or artifact_readiness.evidence->>'artifactDigest' is distinct from
         coalesce(p_previous_artifact_digest, publication_event.artifact_digest)
       or (p_previous_release_id is null and current_publication.brand_id is not null)
       or (p_previous_release_id is not null and (
         current_publication.brand_id is null
         or current_publication.current_release_id is distinct from p_previous_release_id
         or current_publication.artifact_digest is distinct from p_previous_artifact_digest
         or current_publication.deployment_commit_sha is distinct from p_previous_commit_sha
         or current_publication.published_at is distinct from p_previous_published_at
         or current_publication.updated_at
           is distinct from publication_event.previous_updated_at
       ))
       or (p_previous_release_id is not null and (
         previous_release.id is null
         or previous_release.status is distinct from 'published'
         or previous_release.artifact_digest is distinct from p_previous_artifact_digest
         or previous_release.deployment_commit_sha is distinct from p_previous_commit_sha
         or previous_release.published_at is distinct from p_previous_published_at
         or previous_release.superseded_at is not null
         or previous_release.object_retention_until is not null
         or previous_release.objects_purged_at is not null
         or previous_release.purge_started_at is not null
         or previous_release.purge_claim_id is not null
         or previous_release.purge_lease_until is not null
         or previous_release.purge_reason is not null
         or previous_release.purge_blocked_at is not null
         or previous_release.purge_blocked_reason is not null
       )) then
      raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
    end if;
    return 'compensated';
  end if;

  if artifact_readiness.status is distinct from 'passed'
     or artifact_readiness.evidence->>'artifactDigest'
       is distinct from publication_event.artifact_digest then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;

  if current_publication.brand_id is null
     or current_publication.current_release_id is distinct from p_release_id
     or current_publication.artifact_digest is distinct from publication_event.artifact_digest
     or current_publication.deployment_commit_sha is distinct from p_commit_sha
     or current_publication.published_at is distinct from publication_event.promoted_at
     or target_release.status is distinct from 'published'
     or target_release.artifact_digest is distinct from publication_event.artifact_digest
     or target_release.deployment_commit_sha is distinct from p_commit_sha
     or target_release.published_at is distinct from publication_event.promoted_at
     or target_release.superseded_at is not null
     or target_release.object_retention_until is not null
     or target_release.objects_purged_at is not null
     or target_release.purge_started_at is not null
     or target_release.purge_claim_id is not null
     or target_release.purge_lease_until is not null
     or target_release.purge_reason is not null
     or target_release.purge_blocked_at is not null
     or target_release.purge_blocked_reason is not null then
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
    if previous_release.status is distinct from 'superseded'
       or previous_release.artifact_digest is distinct from p_previous_artifact_digest
       or previous_release.deployment_commit_sha is distinct from p_previous_commit_sha
       or previous_release.published_at is distinct from p_previous_published_at
       or previous_release.objects_purged_at is not null
       or previous_release.purge_started_at is not null
       or previous_release.purge_claim_id is not null
       or previous_release.purge_lease_until is not null
       or previous_release.purge_reason is not null
       or previous_release.purge_blocked_at is not null
       or previous_release.purge_blocked_reason is not null
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
        purge_started_at = null, purge_claim_id = null, purge_lease_until = null,
        purge_reason = null, purge_blocked_at = null, purge_blocked_reason = null
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

  if p_previous_artifact_digest is not null then
    perform public.record_organization_readiness(
      p_brand_id, 'tenant_artifacts', true,
      jsonb_build_object('artifactDigest', p_previous_artifact_digest)
    );
  end if;

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
  restored_release public.tenant_package_releases%rowtype;
  readiness public.organization_readiness_checks%rowtype;
  artifact_readiness public.organization_readiness_checks%rowtype;
  confirmation_id bigint;
begin
  if p_brand_id is null or p_release_id is null or p_commit_sha is null
     or p_canary_reference is null or p_approval_reference is null
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
  if exists (
    select 1 from public.tenant_package_publication_events later_event
    where later_event.brand_id = p_brand_id
      and later_event.id > publication_event.id
  ) then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into compensation
  from public.tenant_package_publication_compensations compensation_row
  where compensation_row.publication_event_id = publication_event.id;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  if compensation.brand_id is distinct from p_brand_id
     or compensation.failed_release_id is distinct from p_release_id
     or compensation.restored_release_id
       is distinct from publication_event.previous_package_release_id
     or compensation.failed_deployment_commit_sha is distinct from p_commit_sha
     or compensation.restored_deployment_commit_sha
       is distinct from publication_event.previous_deployment_commit_sha then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into artifact_readiness
  from public.organization_readiness_checks artifact
  where artifact.brand_id = p_brand_id
    and artifact.check_key = 'tenant_artifacts'
  for update;
  if not found
     or artifact_readiness.status is distinct from 'passed'
     or artifact_readiness.evidence->>'artifactDigest' is distinct from
       coalesce(
         publication_event.previous_artifact_digest,
         publication_event.artifact_digest
       ) then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into readiness
  from public.organization_readiness_checks readiness_row
  where readiness_row.brand_id = p_brand_id
    and readiness_row.check_key = 'release_approval'
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
  end if;
  select * into current_publication
  from public.tenant_package_publications publication
  where publication.brand_id = p_brand_id for update;
  if publication_event.previous_package_release_id is not null then
    select * into restored_release from public.tenant_package_releases release
    where release.id = publication_event.previous_package_release_id
      and release.brand_id = p_brand_id for update;
  end if;
  if (publication_event.previous_package_release_id is null
       and current_publication.brand_id is not null)
     or (publication_event.previous_package_release_id is not null and (
       current_publication.brand_id is null
       or current_publication.current_release_id
         is distinct from publication_event.previous_package_release_id
       or current_publication.artifact_digest
         is distinct from publication_event.previous_artifact_digest
       or current_publication.deployment_commit_sha
         is distinct from publication_event.previous_deployment_commit_sha
       or current_publication.published_at
         is distinct from publication_event.previous_published_at
       or current_publication.updated_at
         is distinct from publication_event.previous_updated_at
       or restored_release.id is null
       or restored_release.status is distinct from 'published'
       or restored_release.artifact_digest
         is distinct from publication_event.previous_artifact_digest
       or restored_release.deployment_commit_sha
         is distinct from publication_event.previous_deployment_commit_sha
       or restored_release.published_at
         is distinct from publication_event.previous_published_at
       or restored_release.superseded_at is not null
       or restored_release.object_retention_until is not null
       or restored_release.objects_purged_at is not null
       or restored_release.purge_started_at is not null
       or restored_release.purge_claim_id is not null
       or restored_release.purge_lease_until is not null
       or restored_release.purge_reason is not null
       or restored_release.purge_blocked_at is not null
       or restored_release.purge_blocked_reason is not null
     )) then
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
    if readiness.status is distinct from (
         case when publication_event.previous_package_release_id is null
           then 'failed' else 'passed' end
       )
       or readiness.evidence->>'compensationId' is distinct from compensation.id::text
       or readiness.evidence->>'compensationConfirmationId'
         is distinct from confirmation_id::text
       or readiness.evidence->>'compensatedPublicationEventId'
         is distinct from publication_event.id::text
       or readiness.evidence->>'providerRollbackCompleted' is distinct from 'true' then
      raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
    end if;
    return 'confirmed';
  end if;
  if readiness.status is distinct from 'failed'
     or readiness.evidence->>'compensationId' is distinct from compensation.id::text
     or readiness.evidence->>'compensatedPublicationEventId'
       is distinct from publication_event.id::text
     or readiness.evidence->>'providerRollbackPending' is distinct from 'true' then
    raise exception using errcode = '23514', message = 'tenant_package_compensation_conflict';
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

create or replace function public.record_organization_readiness(
  p_brand_id uuid,
  p_check_key text,
  p_passed boolean,
  p_evidence jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  artifact_readiness public.organization_readiness_checks%rowtype;
begin
  if p_brand_id is null or p_check_key is null or p_passed is null
     or jsonb_typeof(p_evidence) is distinct from 'object'
     or octet_length(p_evidence::text) > 16384
     or (p_check_key = 'tenant_artifacts'
       and coalesce(p_evidence->>'artifactDigest', '')
         !~ '^sha256:[0-9a-f]{64}$')
     or (p_check_key = 'release_approval'
       and coalesce(p_evidence->>'commitSha', '') !~ '^[0-9a-f]{40}$')
     or (p_check_key = 'release_approval'
       and coalesce(p_evidence->>'artifactDigest', '')
         !~ '^sha256:[0-9a-f]{64}$')
     or (p_check_key = 'release_approval'
       and coalesce(p_evidence->>'providerReference', '')
         !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$')
     or (p_check_key = 'payment_provider'
       and coalesce(p_evidence->>'providerReference', '')
         !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$')
     or p_check_key not in (
       'tenant_artifacts', 'release_approval', 'payment_provider'
     ) then
    raise exception using
      errcode = '22023', message = 'immutable_readiness_evidence_required';
  end if;

  perform 1 from public.brands brand
  where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'readiness_check_not_found';
  end if;

  if p_check_key = 'tenant_artifacts' and exists (
    select 1
    from public.tenant_package_publication_compensations compensation
    join public.tenant_package_publication_events publication_event
      on publication_event.id = compensation.publication_event_id
    left join public.tenant_package_publication_compensation_confirmations confirmation
      on confirmation.compensation_id = compensation.id
    where compensation.brand_id = p_brand_id
      and confirmation.id is null
      and (
        not p_passed
        or p_evidence->>'artifactDigest' is distinct from coalesce(
          publication_event.previous_artifact_digest,
          publication_event.artifact_digest
        )
      )
  ) then
    raise exception using
      errcode = '23514', message = 'tenant_package_compensation_pending';
  end if;

  if p_check_key = 'release_approval' then
    select * into artifact_readiness
    from public.organization_readiness_checks artifact
    where artifact.brand_id = p_brand_id
      and artifact.check_key = 'tenant_artifacts'
    for update;
    if p_passed and (
      not found
      or artifact_readiness.status is distinct from 'passed'
      or artifact_readiness.evidence->>'artifactDigest'
        is distinct from p_evidence->>'artifactDigest'
    ) then
      raise exception using
        errcode = '23514', message = 'tenant_package_release_artifact_mismatch';
    end if;
    if exists (
      select 1
      from public.tenant_package_publication_compensations compensation
      join public.tenant_package_publication_events publication_event
        on publication_event.id = compensation.publication_event_id
      left join public.tenant_package_publication_compensation_confirmations confirmation
        on confirmation.compensation_id = compensation.id
      where compensation.brand_id = p_brand_id
        and confirmation.id is null
        and (
          p_passed
          or p_evidence is distinct from jsonb_build_object(
            'commitSha', publication_event.deployment_commit_sha,
            'artifactDigest', publication_event.artifact_digest,
            'providerReference', compensation.rollback_approval_reference,
            'canaryReference', compensation.rollback_canary_reference,
            'compensationId', compensation.id,
            'compensatedPublicationEventId', publication_event.id,
            'restoredReleaseId', publication_event.previous_package_release_id,
            'restoredCommitSha', publication_event.previous_deployment_commit_sha,
            'providerRollbackPending', true
          )
        )
    ) then
      raise exception using
        errcode = '23514', message = 'tenant_package_compensation_pending';
    end if;
  end if;

  update public.organization_readiness_checks set
    status = case when p_passed then 'passed' else 'failed' end,
    evidence = p_evidence, checked_at = now(), checked_by = null
  where brand_id = p_brand_id and check_key = p_check_key;
  if not found then
    raise exception using errcode = '23503', message = 'readiness_check_not_found';
  end if;
  if p_check_key = 'tenant_artifacts' and p_passed then
    update public.organization_readiness_checks approval set
      status = 'pending', evidence = '{}'::jsonb,
      checked_at = null, checked_by = null
    where approval.brand_id = p_brand_id
      and approval.check_key = 'release_approval'
      and approval.status = 'passed'
      and approval.evidence->>'artifactDigest'
        is distinct from p_evidence->>'artifactDigest';
  end if;
  update public.organization_provisioning_runs set stage = case
    when not exists (
      select 1 from public.organization_readiness_checks check_row
      where check_row.brand_id = p_brand_id and check_row.required
        and check_row.status <> 'passed'
    ) then 'ready' else 'awaiting_external' end
  where brand_id = p_brand_id;
  return true;
end $$;
revoke all on function public.record_organization_readiness(
  uuid, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.record_organization_readiness(
  uuid, text, boolean, jsonb
) to service_role;

create function app.assert_tenant_package_publication_compensation()
returns void language plpgsql stable set search_path = '' as $$
declare
  relation_name text;
  privilege_name text;
  index_name text;
  sequence_name text;
  rpc_signature text;
  rpc_oid oid;
  role_name text;
begin
  perform app.assert_tenant_package_publication_serialized();
  perform app.assert_tenant_package_upload_sessions();

  foreach index_name in array array[
    'public.tenant_package_publication_events_release_idx',
    'public.tenant_package_publication_events_previous_release_idx',
    'public.tenant_package_publication_compensations_event_brand_idx',
    'public.tenant_package_publication_compensations_brand_idx',
    'public.tenant_package_publication_compensations_failed_release_idx',
    'public.tenant_package_publication_compensations_restored_release_idx',
    'public.tenant_package_compensation_confirmations_comp_brand_idx',
    'public.tenant_package_compensation_confirmations_brand_idx'
  ] loop
    if pg_catalog.to_regclass(index_name) is null then
      raise exception 'tenant package publication index is missing: %', index_name;
    end if;
  end loop;
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.conrelid in (
        'public.tenant_package_publication_events'::regclass,
        'public.tenant_package_publication_compensations'::regclass,
        'public.tenant_package_publication_compensation_confirmations'::regclass
      )
      and not exists (
        select 1 from pg_catalog.pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid and index_row.indisready
          and index_row.indpred is null
          and index_row.indnkeyatts >= cardinality(constraint_row.conkey)
          and not exists (
            select 1
            from unnest(constraint_row.conkey) with ordinality
              as key_column(attribute_number, position)
            where (index_row.indkey::smallint[])[key_column.position - 1]
              is distinct from key_column.attribute_number
          )
      )
  ) then
    raise exception 'tenant package publication foreign key index is missing';
  end if;

  foreach relation_name in array array[
    'public.tenant_package_publication_events',
    'public.tenant_package_publication_compensations',
    'public.tenant_package_publication_compensation_confirmations'
  ] loop
    if not coalesce((
      select relation.relrowsecurity
      from pg_catalog.pg_class relation
      where relation.oid = pg_catalog.to_regclass(relation_name)
    ), false)
       or not pg_catalog.has_table_privilege(
         'service_role', relation_name, 'SELECT'
       )
       or pg_catalog.has_table_privilege('anon', relation_name, 'SELECT')
       or pg_catalog.has_table_privilege(
         'authenticated', relation_name, 'SELECT'
       ) then
      raise exception 'tenant package audit relation is exposed: %', relation_name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] loop
        if pg_catalog.has_table_privilege(
          role_name, relation_name, privilege_name
        ) then
          raise exception 'tenant package audit relation is writable: %', relation_name;
        end if;
      end loop;
    end loop;
  end loop;

  foreach relation_name in array array[
    'public.tenant_package_releases',
    'public.tenant_package_files',
    'public.tenant_package_publications',
    'public.organization_readiness_checks'
  ] loop
    if not pg_catalog.has_table_privilege(
      'service_role', relation_name, 'SELECT'
    ) then
      raise exception 'tenant package state is unreadable: %', relation_name;
    end if;
    foreach privilege_name in array array[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] loop
      if pg_catalog.has_table_privilege(
        'service_role', relation_name, privilege_name
      ) then
        raise exception 'tenant package state is directly writable: %', relation_name;
      end if;
    end loop;
  end loop;

  foreach sequence_name in array array[
    'public.tenant_package_publication_events_id_seq',
    'public.tenant_package_publication_compensations_id_seq',
    'public.tenant_package_publication_compensation_confirmations_id_seq'
  ] loop
    foreach privilege_name in array array['USAGE', 'SELECT', 'UPDATE'] loop
      if pg_catalog.has_sequence_privilege(
        'service_role', sequence_name, privilege_name
      ) or pg_catalog.has_sequence_privilege(
        'anon', sequence_name, privilege_name
      ) or pg_catalog.has_sequence_privilege(
        'authenticated', sequence_name, privilege_name
      ) then
        raise exception 'tenant package audit sequence is exposed: %', sequence_name;
      end if;
    end loop;
  end loop;

  foreach rpc_signature in array array[
    'public.publish_tenant_package_if_current(uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
    'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
    'public.confirm_tenant_package_publication_compensation(uuid,uuid,text,text,text)',
    'public.record_organization_readiness(uuid,text,boolean,jsonb)'
  ] loop
    rpc_oid := pg_catalog.to_regprocedure(rpc_signature);
    if rpc_oid is null
       or not pg_catalog.has_function_privilege(
         'service_role', rpc_oid, 'EXECUTE'
       )
       or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated', rpc_oid, 'EXECUTE'
       )
       or not coalesce((
         select function_row.prosecdef
          and function_row.proconfig @> array['search_path=""']::text[]
         from pg_catalog.pg_proc function_row where function_row.oid = rpc_oid
       ), false) then
      raise exception 'tenant package service function is unsafe: %', rpc_signature;
    end if;
  end loop;

  rpc_oid := pg_catalog.to_regprocedure(
    'public.publish_tenant_package(uuid,text,text,text,text,text)'
  );
  if rpc_oid is null
     or pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     or not coalesce((
       select function_row.prosecdef
         and function_row.proconfig @> array['search_path=""']::text[]
       from pg_catalog.pg_proc function_row where function_row.oid = rpc_oid
     ), false) then
    raise exception 'legacy tenant package publication function is exposed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.tenant_package_publication_events'::regclass
      and attribute.attname = 'snapshot_version' and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'public.tenant_package_publication_compensations'::regclass
      and trigger_row.tgname = 'tenant_package_publication_compensations_immutable'
      and not trigger_row.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'public.tenant_package_publication_compensation_confirmations'::regclass
      and trigger_row.tgname =
        'tenant_package_publication_compensation_confirmations_immutable'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'tenant package compensation integrity is incomplete';
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
