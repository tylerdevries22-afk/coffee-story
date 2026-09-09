-- Treat a release as deployment evidence rather than as the artifact itself.
-- Identical immutable objects may back later deployments and rollbacks, while
-- one partial unique index makes split-brain publication impossible.
alter table public.tenant_package_releases
  drop constraint if exists tenant_package_releases_brand_id_artifact_digest_key;
alter table public.tenant_package_releases
  add column purge_started_at timestamptz,
  add column purge_claim_id uuid,
  add column purge_lease_until timestamptz,
  add constraint tenant_package_purge_claim_complete check (
    (purge_claim_id is null and purge_lease_until is null)
    or (purge_claim_id is not null and purge_lease_until is not null
      and purge_started_at is not null)
  );

with ranked as (
  select release.id,
    row_number() over (
      partition by release.brand_id
      order by (publication.current_release_id = release.id) desc,
        release.published_at desc nulls last, release.id
    ) as position
  from public.tenant_package_releases release
  left join public.tenant_package_publications publication
    on publication.brand_id = release.brand_id
  where release.status = 'published'
)
update public.tenant_package_releases release set
  status = 'superseded',
  superseded_at = coalesce(release.superseded_at, now()),
  object_retention_until = coalesce(release.object_retention_until, now() + interval '1 year')
from ranked where ranked.id = release.id and ranked.position > 1;

create unique index tenant_package_releases_one_published_per_brand_idx
  on public.tenant_package_releases (brand_id) where status = 'published';

create table public.tenant_package_publication_events (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands (id) on delete restrict,
  package_release_id uuid not null,
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  deployment_commit_sha text not null check (deployment_commit_sha ~ '^[0-9a-f]{40}$'),
  canary_reference text not null check (
    canary_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
  ),
  approval_reference text not null check (
    approval_reference ~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
  ),
  promoted_at timestamptz not null default now(),
  foreign key (package_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  unique (
    brand_id, package_release_id, deployment_commit_sha,
    canary_reference, approval_reference
  )
);
alter table public.tenant_package_publication_events enable row level security;
create index tenant_package_publication_events_release_idx
  on public.tenant_package_publication_events (package_release_id, brand_id);
revoke all on table public.tenant_package_publication_events
  from public, anon, authenticated, service_role;
grant select on table public.tenant_package_publication_events to service_role;
revoke all on sequence public.tenant_package_publication_events_id_seq
  from public, anon, authenticated, service_role;
create trigger tenant_package_publication_events_immutable
before update or delete on public.tenant_package_publication_events
for each row execute function app_private.reject_tenant_package_event_mutation();
revoke all on table
  public.tenant_package_releases,
  public.tenant_package_files,
  public.tenant_package_publications
from service_role;
grant select on table
  public.tenant_package_releases,
  public.tenant_package_files,
  public.tenant_package_publications
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
  promotion_time timestamptz := now();
begin
  if p_brand_id is null or p_release_key is null or p_artifact_digest is null
     or p_commit_sha is null or p_canary_reference is null or p_approval_reference is null
     or p_release_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'
     or p_artifact_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_canary_reference !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$'
     or p_approval_reference !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$' then
    raise exception using errcode = '22023', message = 'tenant_package_evidence_invalid';
  end if;
  perform 1 from public.brands brand where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'tenant_package_release_mismatch';
  end if;
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
  insert into public.tenant_package_publication_events (
    brand_id, package_release_id, artifact_digest, deployment_commit_sha,
    canary_reference, approval_reference, promoted_at
  ) values (
    p_brand_id, release_row.id, p_artifact_digest, p_commit_sha,
    p_canary_reference, p_approval_reference, promotion_time
  ) on conflict (
    brand_id, package_release_id, deployment_commit_sha,
    canary_reference, approval_reference
  ) do nothing returning promoted_at into promotion_time;
  if not found then
    if exists (
      select 1 from public.tenant_package_publications publication
      where publication.brand_id = p_brand_id
        and publication.current_release_id = release_row.id
        and publication.deployment_commit_sha = p_commit_sha
    ) then
      return release_row.id;
    end if;
    raise exception using errcode = '23514', message = 'tenant_package_evidence_replayed';
  end if;
  update public.tenant_package_releases release set
    status = 'superseded', superseded_at = now(),
    object_retention_until = now() + interval '1 year'
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

revoke execute on function public.list_tenant_package_cleanup_candidates(integer)
  from service_role;
revoke execute on function public.confirm_tenant_package_object_purge(uuid[])
  from service_role;

create or replace function public.claim_tenant_package_cleanup_candidates(
  p_limit integer default 500
) returns table (object_path text, release_id uuid, claim_id uuid, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  target_release uuid;
  target_claim uuid := gen_random_uuid();
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_limit_invalid';
  end if;
  select release.id into target_release
  from public.tenant_package_releases release
  left join public.tenant_package_publications publication
    on publication.current_release_id = release.id
  where release.status = 'superseded'
    and release.object_retention_until <= statement_timestamp()
    and release.objects_purged_at is null
    and publication.current_release_id is null
    and (release.purge_lease_until is null
      or release.purge_lease_until <= statement_timestamp())
  order by release.object_retention_until, release.id
  for update of release skip locked limit 1;
  if target_release is not null then
    update public.tenant_package_releases release set
      purge_started_at = coalesce(release.purge_started_at, statement_timestamp()),
      purge_claim_id = target_claim,
      purge_lease_until = statement_timestamp() + interval '10 minutes'
    where release.id = target_release;
    return query
    with paths as (
      select release.archive_object_path as path from public.tenant_package_releases release
      where release.id = target_release
      union all
      select file.object_path from public.tenant_package_files file
      where file.package_release_id = target_release
      union all
      select file.preview_object_path from public.tenant_package_files file
      where file.package_release_id = target_release and file.preview_object_path is not null
    )
    select object_row.name, target_release, target_claim, 'retention_expired'::text
    from paths join storage.objects object_row
      on object_row.bucket_id = 'tenant-packages' and object_row.name = paths.path
    order by object_row.name limit p_limit;
    if not found then
      return query select null::text, target_release, target_claim, 'retention_expired'::text;
    end if;
    return;
  end if;
  -- Canonical namespace uploads are never deleted without a release claim.
  -- An upload session must fence staging before orphan reclamation can be safe.
  return;
end $$;
revoke all on function public.claim_tenant_package_cleanup_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.claim_tenant_package_cleanup_candidates(integer)
  to service_role;

create or replace function public.confirm_tenant_package_purge_claim(p_claim_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  release_row public.tenant_package_releases%rowtype;
begin
  if p_claim_id is null then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_claim_invalid';
  end if;
  select * into release_row from public.tenant_package_releases release
  where release.purge_claim_id = p_claim_id for update;
  if not found or release_row.status <> 'superseded'
     or release_row.object_retention_until > statement_timestamp()
     or exists (select 1 from public.tenant_package_publications publication
       where publication.current_release_id = release_row.id) then
    raise exception using errcode = '23514', message = 'tenant_package_cleanup_claim_invalid';
  end if;
  if exists (
    select 1 from storage.objects object_row
    where object_row.bucket_id = 'tenant-packages' and (
      object_row.name = release_row.archive_object_path or exists (
        select 1 from public.tenant_package_files file
        where file.package_release_id = release_row.id
          and object_row.name in (file.object_path, file.preview_object_path)
      )
    )
  ) then
    update public.tenant_package_releases release set
      purge_claim_id = null, purge_lease_until = null
    where release.id = release_row.id;
    return false;
  end if;
  update public.tenant_package_releases release set
    objects_purged_at = statement_timestamp(),
    purge_claim_id = null, purge_lease_until = null
  where release.id = release_row.id;
  return true;
end $$;
revoke all on function public.confirm_tenant_package_purge_claim(uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_tenant_package_purge_claim(uuid)
  to service_role;

create or replace function app.assert_tenant_package_publication_serialized()
returns void language plpgsql stable set search_path = '' as $$
declare
  relation_name text;
  privilege_name text;
begin
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'tenant_package_releases'
      and indexname = 'tenant_package_releases_one_published_per_brand_idx'
      and indexdef ilike '%unique%where (status = ''published''%'
  ) then
    raise exception 'tenant package publication invariant is missing';
  end if;
  if pg_catalog.to_regclass('public.tenant_package_publication_events') is null then
    raise exception 'tenant package publication audit is missing';
  end if;
  if not pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'REFERENCES'
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'public.tenant_package_publication_events', 'TRIGGER'
     )
     or pg_catalog.has_sequence_privilege(
       'service_role', 'public.tenant_package_publication_events_id_seq', 'USAGE'
     )
     or pg_catalog.has_sequence_privilege(
       'service_role', 'public.tenant_package_publication_events_id_seq', 'SELECT'
     )
     or pg_catalog.has_sequence_privilege(
       'service_role', 'public.tenant_package_publication_events_id_seq', 'UPDATE'
     ) then
    raise exception 'tenant package publication audit privileges are unsafe';
  end if;
  foreach relation_name in array array[
    'public.tenant_package_releases',
    'public.tenant_package_files',
    'public.tenant_package_publications'
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
end $$;

revoke all on function app.assert_tenant_package_publication_serialized()
  from public, anon, authenticated;
grant execute on function app.assert_tenant_package_publication_serialized()
  to service_role;

select app.register_release(
  '20260908226000',
  'serialize tenant package publication and permit artifact reuse',
  'app.assert_tenant_package_publication_serialized()'::regprocedure
);
