-- Fence object upload, staging, and retention with one durable namespace lease.
create table app_private.tenant_package_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete restrict,
  release_key text not null check (release_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'),
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_commit_sha text not null check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  envelope_sha256 text not null check (envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  archive_sha256 text not null check (archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  object_prefix text not null check (octet_length(object_prefix) = 166),
  file_count integer not null check (file_count between 1 and 100000),
  total_bytes bigint not null check (total_bytes between 1 and 1073741824),
  status text not null default 'open' check (status in ('open', 'staged', 'purged')),
  expires_at timestamptz not null,
  staged_release_id uuid,
  closed_at timestamptz,
  purge_started_at timestamptz,
  purge_claim_id uuid,
  purge_lease_until timestamptz,
  purge_blocked_at timestamptz,
  purge_blocked_reason text check (purge_blocked_reason in ('noncanonical_objects')),
  objects_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, release_key),
  unique (id, brand_id),
  foreign key (staged_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  check (object_prefix = brand_id::text || '/' || substring(artifact_digest from 8)
    || '/' || substring(envelope_sha256 from 8)),
  check ((status = 'open' and staged_release_id is null and closed_at is null)
    or (status = 'staged' and staged_release_id is not null and closed_at is not null)
    or status = 'purged'),
  check ((purge_claim_id is null and purge_lease_until is null)
    or (purge_claim_id is not null and purge_lease_until is not null
      and purge_started_at is not null)),
  check ((status = 'purged' and objects_purged_at is not null)
    or status <> 'purged')
);

create index tenant_package_upload_sessions_cleanup_idx
  on app_private.tenant_package_upload_sessions (expires_at, id)
  where objects_purged_at is null;
create index tenant_package_upload_sessions_staged_release_idx
  on app_private.tenant_package_upload_sessions (staged_release_id, brand_id);
alter table app_private.tenant_package_upload_sessions enable row level security;
revoke all on table app_private.tenant_package_upload_sessions
  from public, anon, authenticated, service_role;

create table app_private.tenant_package_purge_claim_outcomes (
  claim_id uuid primary key,
  result boolean not null,
  confirmed_at timestamptz not null default now()
);
alter table app_private.tenant_package_purge_claim_outcomes enable row level security;
revoke all on table app_private.tenant_package_purge_claim_outcomes
  from public, anon, authenticated, service_role;

create or replace function app_private.is_canonical_tenant_package_prefix(p_prefix text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    octet_length(p_prefix) in (101, 166)
    and p_prefix ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}(/[0-9a-f]{64})?$',
    false
  )
$$;
revoke all on function app_private.is_canonical_tenant_package_prefix(text)
  from public, anon, authenticated, service_role;

create or replace function app_private.is_deletable_tenant_package_object(
  p_name text, p_prefix text
) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    app_private.is_canonical_tenant_package_prefix(p_prefix)
    and octet_length(p_name) <= 1500
    and p_name !~ '(\\|[[:cntrl:]]|(^|/)\.{1,2}(/|$)|//|/$)'
    and (
      p_name = p_prefix || '/archive.zip'
      or (p_name like p_prefix || '/files/%'
        and length(p_name) > length(p_prefix) + 7)
      or (p_name like p_prefix || '/previews/%'
        and length(p_name) > length(p_prefix) + 10)
    ),
    false
  )
$$;
revoke all on function app_private.is_deletable_tenant_package_object(text, text)
  from public, anon, authenticated, service_role;

create or replace function app_private.is_tenant_package_namespace_object(
  p_name text, p_prefix text
) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    app_private.is_canonical_tenant_package_prefix(p_prefix)
    and (p_name = p_prefix or p_name like p_prefix || '/%')
    and (array_length(regexp_split_to_array(p_prefix, '/'), 1) <> 2
      or substring(p_name from length(p_prefix) + 2) !~ '^[0-9a-f]{64}(/|$)'),
    false
  )
$$;
revoke all on function app_private.is_tenant_package_namespace_object(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.begin_tenant_package_upload(
  p_brand_id uuid,
  p_release_key text,
  p_artifact_digest text,
  p_commit_sha text,
  p_envelope_sha256 text,
  p_archive_sha256 text,
  p_object_prefix text,
  p_file_count integer,
  p_total_bytes bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  session_row app_private.tenant_package_upload_sessions%rowtype;
  expected_prefix text := p_brand_id::text || '/' || substring(p_artifact_digest from 8)
    || '/' || substring(p_envelope_sha256 from 8);
begin
  if p_brand_id is null or p_release_key is null or p_artifact_digest is null
     or p_commit_sha is null or p_envelope_sha256 is null or p_archive_sha256 is null
     or p_object_prefix is null or p_file_count is null or p_total_bytes is null
     or p_release_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'
     or p_artifact_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_envelope_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_archive_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_object_prefix <> expected_prefix
     or p_file_count not between 1 and 100000
     or p_total_bytes not between 1 and 1073741824 then
    raise exception using errcode = '22023', message = 'tenant_package_upload_invalid';
  end if;

  perform 1 from public.brands brand
  where brand.id = p_brand_id and brand.status in ('provisioning', 'active') for update;
  if not found then
    raise exception using errcode = '23503', message = 'tenant_package_brand_unavailable';
  end if;
  if exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.brand_id = p_brand_id
      and upload_session.object_prefix = p_object_prefix
      and upload_session.objects_purged_at is null
      and (upload_session.purge_started_at is not null
        or upload_session.purge_claim_id is not null
        or upload_session.purge_blocked_at is not null)
  ) or exists (
    select 1 from public.tenant_package_releases release
    where release.brand_id = p_brand_id
      and release.archive_object_path = p_object_prefix || '/archive.zip'
      and release.objects_purged_at is null
      and (release.purge_started_at is not null
        or release.purge_claim_id is not null
        or release.purge_blocked_at is not null)
  ) then
    raise exception using errcode = '23514', message = 'tenant_package_upload_closed';
  end if;

  select * into session_row from app_private.tenant_package_upload_sessions upload_session
  where upload_session.brand_id = p_brand_id
    and upload_session.release_key = p_release_key for update;
  if found then
    if session_row.artifact_digest <> p_artifact_digest
       or session_row.source_commit_sha <> p_commit_sha
       or session_row.envelope_sha256 <> p_envelope_sha256
       or session_row.archive_sha256 <> p_archive_sha256
       or session_row.object_prefix <> p_object_prefix
       or session_row.file_count <> p_file_count
       or session_row.total_bytes <> p_total_bytes then
      raise exception using errcode = '23505', message = 'tenant_package_upload_conflict';
    end if;
    if session_row.status = 'staged' and session_row.purge_started_at is null then
      return session_row.id;
    end if;
    if session_row.status <> 'open' or session_row.purge_started_at is not null then
      raise exception using errcode = '23514', message = 'tenant_package_upload_closed';
    end if;
    update app_private.tenant_package_upload_sessions upload_session set
      expires_at = clock_timestamp() + interval '15 minutes',
      updated_at = statement_timestamp()
    where upload_session.id = session_row.id;
    return session_row.id;
  end if;

  insert into app_private.tenant_package_upload_sessions (
    brand_id, release_key, artifact_digest, source_commit_sha, envelope_sha256,
    archive_sha256, object_prefix, file_count, total_bytes, expires_at
  ) values (
    p_brand_id, p_release_key, p_artifact_digest, p_commit_sha, p_envelope_sha256,
    p_archive_sha256, p_object_prefix, p_file_count, p_total_bytes,
    clock_timestamp() + interval '15 minutes'
  ) returning id into session_row.id;
  return session_row.id;
end $$;

revoke all on function public.begin_tenant_package_upload(
  uuid, text, text, text, text, text, text, integer, bigint
) from public, anon, authenticated;
grant execute on function public.begin_tenant_package_upload(
  uuid, text, text, text, text, text, text, integer, bigint
) to service_role;

create or replace function public.renew_tenant_package_upload(p_session_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  renewed_until timestamptz;
  session_row app_private.tenant_package_upload_sessions%rowtype;
begin
  if p_session_id is null then
    raise exception using errcode = '22023', message = 'tenant_package_upload_invalid';
  end if;
  select * into session_row from app_private.tenant_package_upload_sessions upload_session
  where upload_session.id = p_session_id for update;
  if not found or session_row.purge_started_at is not null
     or session_row.status not in ('open', 'staged') then
    raise exception using errcode = '23514', message = 'tenant_package_upload_closed';
  end if;
  if session_row.status = 'staged' then
    if not exists (
      select 1 from public.tenant_package_releases release
      where release.id = session_row.staged_release_id
        and release.objects_purged_at is null
    ) then
      raise exception using errcode = '23514', message = 'tenant_package_upload_closed';
    end if;
    return session_row.expires_at;
  end if;
  renewed_until := clock_timestamp() + interval '15 minutes';
  update app_private.tenant_package_upload_sessions upload_session set
    expires_at = renewed_until, updated_at = statement_timestamp()
  where upload_session.id = p_session_id;
  return renewed_until;
end $$;
revoke all on function public.renew_tenant_package_upload(uuid)
  from public, anon, authenticated;
grant execute on function public.renew_tenant_package_upload(uuid) to service_role;

alter function public.stage_tenant_package(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb
) rename to stage_tenant_package_without_session;
alter function public.stage_tenant_package_without_session(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb
) set schema app_private;
revoke all on function app_private.stage_tenant_package_without_session(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.stage_tenant_package(
  p_brand_id uuid,
  p_release_key text,
  p_artifact_digest text,
  p_commit_sha text,
  p_envelope_sha256 text,
  p_archive_sha256 text,
  p_archive_object_path text,
  p_file_count integer,
  p_total_bytes bigint,
  p_files jsonb,
  p_upload_session_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  release_id uuid;
  session_row app_private.tenant_package_upload_sessions%rowtype;
  expected_prefix text := p_brand_id::text || '/' || substring(p_artifact_digest from 8)
    || '/' || substring(p_envelope_sha256 from 8);
begin
  perform 1 from public.brands brand
  where brand.id = p_brand_id and brand.status in ('provisioning', 'active') for update;
  if not found then
    raise exception using errcode = '23503', message = 'tenant_package_brand_unavailable';
  end if;
  select * into session_row from app_private.tenant_package_upload_sessions upload_session
  where upload_session.id = p_upload_session_id for update;
  if not found or session_row.brand_id <> p_brand_id
     or session_row.release_key <> p_release_key
     or session_row.artifact_digest <> p_artifact_digest
     or session_row.source_commit_sha <> p_commit_sha
     or session_row.envelope_sha256 <> p_envelope_sha256
     or session_row.archive_sha256 <> p_archive_sha256
     or session_row.object_prefix <> expected_prefix
     or session_row.file_count <> p_file_count
     or session_row.total_bytes <> p_total_bytes then
    raise exception using errcode = '23514', message = 'tenant_package_upload_mismatch';
  end if;
  if session_row.status = 'staged' and session_row.purge_started_at is null then
    if not app_private.tenant_package_manifest_matches(
      session_row.staged_release_id, p_files
    ) then
      raise exception using errcode = '23514', message = 'tenant_package_upload_mismatch';
    end if;
    release_id := app_private.stage_tenant_package_without_session(
      p_brand_id, p_release_key, p_artifact_digest, p_commit_sha,
      p_envelope_sha256, p_archive_sha256, p_archive_object_path,
      p_file_count, p_total_bytes, p_files
    );
    if release_id is distinct from session_row.staged_release_id then
      raise exception using errcode = '23514', message = 'tenant_package_upload_mismatch';
    end if;
    return release_id;
  end if;
  if session_row.status <> 'open' or session_row.purge_started_at is not null
     or session_row.expires_at <= clock_timestamp() then
    raise exception using errcode = '23514', message = 'tenant_package_upload_closed';
  end if;
  if pg_catalog.jsonb_typeof(p_files) = 'array' and exists (
    select 1 from pg_catalog.jsonb_array_elements(p_files) item
    where coalesce(item->>'relativePath', '') ~ '(^/|\\|[[:cntrl:]]|(^|/)\.{1,2}(/|$)|//|/$)'
       or coalesce(item->>'pathKey', '') ~ '(^/|\\|[[:cntrl:]]|(^|/)\.{1,2}(/|$)|//|/$)'
       or octet_length(coalesce(item->>'objectPath', '')) > 1500
       or octet_length(coalesce(item->>'previewObjectPath', '')) > 1500
  ) then
    raise exception using errcode = '22023', message = 'tenant_package_file_invalid';
  end if;

  release_id := app_private.stage_tenant_package_without_session(
    p_brand_id, p_release_key, p_artifact_digest, p_commit_sha,
    p_envelope_sha256, p_archive_sha256, p_archive_object_path,
    p_file_count, p_total_bytes, p_files
  );
  update app_private.tenant_package_upload_sessions upload_session set
    status = 'staged', staged_release_id = release_id,
    closed_at = statement_timestamp(), updated_at = statement_timestamp()
  where upload_session.id = p_upload_session_id;
  return release_id;
end $$;
revoke all on function public.stage_tenant_package(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.stage_tenant_package(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb, uuid
) to service_role;

alter table public.tenant_package_releases
  add column purge_reason text check (purge_reason in ('retention_expired', 'stale_verified')),
  add column purge_blocked_at timestamptz,
  add column purge_blocked_reason text
    check (purge_blocked_reason in ('noncanonical_objects'));

drop function public.claim_tenant_package_cleanup_candidates(integer);
create function public.claim_tenant_package_cleanup_candidates(
  p_limit integer default 500
) returns table (object_path text, target_id uuid, claim_id uuid, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  target_brand uuid;
  target_prefix text;
  target_identifier uuid;
  target_reason text;
  target_claim uuid := gen_random_uuid();
  claim_lease_until timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_limit_invalid';
  end if;

  select candidate.brand_id, candidate.object_prefix, candidate.id, candidate.reason
  into target_brand, target_prefix, target_identifier, target_reason
  from (
    select upload_session.brand_id, upload_session.object_prefix, upload_session.id,
      'upload_expired'::text as reason, upload_session.expires_at as due_at,
      0 as priority
    from app_private.tenant_package_upload_sessions upload_session
    where upload_session.objects_purged_at is null
      and upload_session.purge_blocked_at is null
      and upload_session.status = 'open'
      and upload_session.expires_at <= clock_timestamp()
      and (upload_session.purge_lease_until is null
        or upload_session.purge_lease_until <= clock_timestamp())
      and not exists (
        select 1 from app_private.tenant_package_upload_sessions active_session
        where active_session.brand_id = upload_session.brand_id
          and active_session.object_prefix = upload_session.object_prefix
          and active_session.objects_purged_at is null
          and active_session.purge_blocked_at is null
          and active_session.status = 'open'
          and active_session.purge_started_at is null
          and active_session.expires_at > clock_timestamp()
      )
      and not exists (
        select 1 from app_private.tenant_package_upload_sessions blocked_session
        where blocked_session.brand_id = upload_session.brand_id
          and blocked_session.object_prefix = upload_session.object_prefix
          and blocked_session.purge_blocked_at is not null
      )
      and not exists (
        select 1 from public.tenant_package_releases sibling
        left join public.tenant_package_publications sibling_publication
          on sibling_publication.current_release_id = sibling.id
        where sibling.brand_id = upload_session.brand_id
          and sibling.archive_object_path = upload_session.object_prefix || '/archive.zip'
          and sibling.objects_purged_at is null
          and (sibling_publication.current_release_id is not null
            or sibling.purge_blocked_at is not null
            or not ((sibling.status = 'verified'
                and sibling.verified_at <= clock_timestamp() - interval '24 hours')
              or (sibling.status = 'superseded'
                and sibling.object_retention_until <= clock_timestamp())
              or (sibling.status = 'failed' and sibling.purge_started_at is not null)))
      )
    union all
    select release.brand_id,
      substring(release.archive_object_path from 1
        for length(release.archive_object_path) - 12),
      release.id,
      case when release.purge_reason = 'stale_verified' or release.status = 'verified'
        then 'stale_verified' else 'retention_expired' end,
      case when release.status = 'verified' then release.verified_at
        else release.object_retention_until end,
      0
    from public.tenant_package_releases release
    left join public.tenant_package_publications publication
      on publication.current_release_id = release.id
    where release.objects_purged_at is null
      and release.purge_blocked_at is null
      and publication.current_release_id is null
      and pg_catalog.right(release.archive_object_path, 12) = '/archive.zip'
      and app_private.is_canonical_tenant_package_prefix(
        pg_catalog.left(
          release.archive_object_path,
          pg_catalog.length(release.archive_object_path) - 12
        )
      )
      and (release.purge_lease_until is null
        or release.purge_lease_until <= clock_timestamp())
      and ((release.status = 'verified'
          and release.verified_at <= clock_timestamp() - interval '24 hours')
        or (release.status = 'superseded'
          and release.object_retention_until <= clock_timestamp())
        or (release.status = 'failed' and release.purge_started_at is not null))
      and not exists (
        select 1 from app_private.tenant_package_upload_sessions active_session
        where active_session.brand_id = release.brand_id
          and active_session.object_prefix = substring(release.archive_object_path from 1
            for length(release.archive_object_path) - 12)
          and active_session.objects_purged_at is null
          and active_session.purge_blocked_at is null
          and active_session.status = 'open'
          and active_session.purge_started_at is null
          and active_session.expires_at > clock_timestamp()
      )
      and not exists (
        select 1 from app_private.tenant_package_upload_sessions blocked_session
        where blocked_session.brand_id = release.brand_id
          and blocked_session.object_prefix = substring(release.archive_object_path from 1
            for length(release.archive_object_path) - 12)
          and blocked_session.purge_blocked_at is not null
      )
      and not exists (
        select 1 from public.tenant_package_releases sibling
        left join public.tenant_package_publications sibling_publication
          on sibling_publication.current_release_id = sibling.id
        where sibling.brand_id = release.brand_id
          and sibling.archive_object_path = release.archive_object_path
          and sibling.objects_purged_at is null
          and (sibling_publication.current_release_id is not null
            or sibling.purge_blocked_at is not null
            or not ((sibling.status = 'verified'
                and sibling.verified_at <= clock_timestamp() - interval '24 hours')
              or (sibling.status = 'superseded'
                and sibling.object_retention_until <= clock_timestamp())
              or (sibling.status = 'failed' and sibling.purge_started_at is not null)))
      )
    union all
    select release.brand_id, null::text, release.id, 'cleanup_blocked'::text,
      case when release.status = 'verified' then release.verified_at
        else release.object_retention_until end,
      1
    from public.tenant_package_releases release
    left join public.tenant_package_publications publication
      on publication.current_release_id = release.id
    where release.objects_purged_at is null
      and release.purge_blocked_at is null
      and publication.current_release_id is null
      and (release.purge_lease_until is null
        or release.purge_lease_until <= clock_timestamp())
      and ((release.status = 'verified'
          and release.verified_at <= clock_timestamp() - interval '24 hours')
        or (release.status = 'superseded'
          and release.object_retention_until <= clock_timestamp())
        or (release.status = 'failed' and release.purge_started_at is not null))
      and (pg_catalog.right(release.archive_object_path, 12) <> '/archive.zip'
        or not app_private.is_canonical_tenant_package_prefix(
          pg_catalog.left(
            release.archive_object_path,
            pg_catalog.length(release.archive_object_path) - 12
          )
        ))
  ) candidate
  order by candidate.priority, candidate.due_at nulls first, candidate.id
  limit 1;
  if target_identifier is null then return; end if;

  perform 1 from public.brands brand where brand.id = target_brand for update;

  if target_reason = 'cleanup_blocked' then
    update public.tenant_package_releases release set
      purge_blocked_at = clock_timestamp(),
      purge_blocked_reason = 'noncanonical_objects',
      purge_claim_id = null,
      purge_lease_until = null
    where release.id = target_identifier
      and release.brand_id = target_brand
      and release.objects_purged_at is null
      and release.purge_blocked_at is null
      and (release.purge_lease_until is null
        or release.purge_lease_until <= clock_timestamp())
      and ((release.status = 'verified'
          and release.verified_at <= clock_timestamp() - interval '24 hours')
        or (release.status = 'superseded'
          and release.object_retention_until <= clock_timestamp())
        or (release.status = 'failed' and release.purge_started_at is not null))
      and not exists (
        select 1 from public.tenant_package_publications publication
        where publication.current_release_id = release.id
      )
      and (pg_catalog.right(release.archive_object_path, 12) <> '/archive.zip'
        or not app_private.is_canonical_tenant_package_prefix(
          pg_catalog.left(
            release.archive_object_path,
            pg_catalog.length(release.archive_object_path) - 12
          )
        ));
    if not found then return; end if;

    insert into app_private.tenant_package_purge_claim_outcomes (claim_id, result)
    values (target_claim, false);
    return query
      select null::text, target_identifier, target_claim, target_reason;
    return;
  end if;

  perform 1 from app_private.tenant_package_upload_sessions upload_session
  where upload_session.brand_id = target_brand
    and upload_session.object_prefix = target_prefix
    and upload_session.objects_purged_at is null for update;
  perform 1 from public.tenant_package_releases release
  where release.brand_id = target_brand
    and release.archive_object_path = target_prefix || '/archive.zip'
    and release.objects_purged_at is null for update;

  if exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.brand_id = target_brand
      and upload_session.object_prefix = target_prefix
      and upload_session.purge_claim_id is not null
      and upload_session.purge_lease_until > clock_timestamp()
  ) or exists (
    select 1 from public.tenant_package_releases release
    where release.brand_id = target_brand
      and release.archive_object_path = target_prefix || '/archive.zip'
      and release.purge_claim_id is not null
      and release.purge_lease_until > clock_timestamp()
  ) or exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.brand_id = target_brand
      and upload_session.object_prefix = target_prefix
      and upload_session.purge_blocked_at is not null
  ) or exists (
    select 1 from public.tenant_package_releases release
    where release.brand_id = target_brand
      and release.archive_object_path = target_prefix || '/archive.zip'
      and release.purge_blocked_at is not null
  ) or exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.brand_id = target_brand
      and upload_session.object_prefix = target_prefix
      and upload_session.objects_purged_at is null
      and upload_session.status = 'open'
      and upload_session.purge_started_at is null
      and upload_session.expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.tenant_package_releases release
    left join public.tenant_package_publications publication
      on publication.current_release_id = release.id
    where release.brand_id = target_brand
      and release.archive_object_path = target_prefix || '/archive.zip'
      and release.objects_purged_at is null
      and (publication.current_release_id is not null
        or not ((release.status = 'verified'
            and release.verified_at <= clock_timestamp() - interval '24 hours')
          or (release.status = 'superseded'
            and release.object_retention_until <= clock_timestamp())
          or (release.status = 'failed' and release.purge_started_at is not null)))
  ) or (
    not exists (
      select 1 from app_private.tenant_package_upload_sessions upload_session
      where upload_session.brand_id = target_brand
        and upload_session.object_prefix = target_prefix
        and upload_session.objects_purged_at is null
        and upload_session.purge_blocked_at is null
        and upload_session.status = 'open'
        and upload_session.expires_at <= clock_timestamp()
    ) and not exists (
      select 1 from public.tenant_package_releases release
      where release.brand_id = target_brand
        and release.archive_object_path = target_prefix || '/archive.zip'
        and release.objects_purged_at is null
        and release.purge_blocked_at is null
        and ((release.status = 'verified'
            and release.verified_at <= clock_timestamp() - interval '24 hours')
          or (release.status = 'superseded'
            and release.object_retention_until <= clock_timestamp())
          or (release.status = 'failed' and release.purge_started_at is not null))
    )
  ) then
    return;
  end if;

  claim_lease_until := clock_timestamp() + interval '10 minutes';
  update app_private.tenant_package_upload_sessions upload_session set
    purge_started_at = coalesce(upload_session.purge_started_at, statement_timestamp()),
    purge_claim_id = target_claim,
    purge_lease_until = claim_lease_until,
    updated_at = statement_timestamp()
  where upload_session.brand_id = target_brand
    and upload_session.object_prefix = target_prefix
    and upload_session.objects_purged_at is null;
  update public.tenant_package_releases release set
    status = case when release.status = 'verified' then 'failed' else release.status end,
    purge_reason = case when release.status = 'verified' then 'stale_verified'
      else coalesce(release.purge_reason, 'retention_expired') end,
    purge_started_at = coalesce(release.purge_started_at, statement_timestamp()),
    purge_claim_id = target_claim,
    purge_lease_until = claim_lease_until
  where release.brand_id = target_brand
    and release.archive_object_path = target_prefix || '/archive.zip'
    and release.objects_purged_at is null;

  if not app_private.is_canonical_tenant_package_prefix(target_prefix)
     or exists (
    select 1 from storage.objects object_row
    where object_row.bucket_id = 'tenant-packages'
      and app_private.is_tenant_package_namespace_object(object_row.name, target_prefix)
      and not app_private.is_deletable_tenant_package_object(
        object_row.name, target_prefix
      )
  ) then
    return query
      select null::text, target_identifier, target_claim, 'cleanup_blocked'::text;
    return;
  end if;

  return query
  select object_row.name, target_identifier, target_claim, target_reason
  from storage.objects object_row
  where object_row.bucket_id = 'tenant-packages'
    and app_private.is_deletable_tenant_package_object(object_row.name, target_prefix)
  order by object_row.name limit p_limit;
  if not found then
    return query select null::text, target_identifier, target_claim, target_reason;
  end if;
end $$;
revoke all on function public.claim_tenant_package_cleanup_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.claim_tenant_package_cleanup_candidates(integer)
  to service_role;

create or replace function public.renew_tenant_package_purge_claim(p_claim_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  target_brand uuid;
  target_prefix text;
  renewed_until timestamptz;
begin
  if p_claim_id is null then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_claim_invalid';
  end if;

  select claimed.brand_id, claimed.object_prefix into target_brand, target_prefix
  from (
    select upload_session.brand_id, upload_session.object_prefix
    from app_private.tenant_package_upload_sessions upload_session
    where upload_session.purge_claim_id = p_claim_id
    union all
    select release.brand_id,
      substring(release.archive_object_path from 1
        for length(release.archive_object_path) - 12)
    from public.tenant_package_releases release
    where release.purge_claim_id = p_claim_id
  ) claimed limit 1;
  if target_brand is null then
    raise exception using errcode = '23514', message = 'tenant_package_cleanup_claim_invalid';
  end if;

  perform 1 from public.brands brand where brand.id = target_brand for update;
  perform 1 from app_private.tenant_package_upload_sessions upload_session
  where upload_session.brand_id = target_brand
    and upload_session.object_prefix = target_prefix
    and upload_session.objects_purged_at is null for update;
  perform 1 from public.tenant_package_releases release
  where release.brand_id = target_brand
    and release.archive_object_path = target_prefix || '/archive.zip'
    and release.objects_purged_at is null for update;

  if not exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.purge_claim_id = p_claim_id
      and upload_session.purge_lease_until > clock_timestamp()
    union all
    select 1 from public.tenant_package_releases release
    where release.purge_claim_id = p_claim_id
      and release.purge_lease_until > clock_timestamp()
  ) or exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.purge_claim_id = p_claim_id
      and (upload_session.purge_lease_until <= clock_timestamp()
        or upload_session.objects_purged_at is not null
        or upload_session.purge_blocked_at is not null)
    union all
    select 1 from public.tenant_package_releases release
    where release.purge_claim_id = p_claim_id
      and (release.purge_lease_until <= clock_timestamp()
        or release.objects_purged_at is not null
        or release.purge_blocked_at is not null)
  ) or exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.brand_id = target_brand
      and upload_session.object_prefix = target_prefix
      and upload_session.objects_purged_at is null
      and upload_session.purge_started_at is not null
      and upload_session.purge_claim_id is distinct from p_claim_id
    union all
    select 1 from public.tenant_package_releases release
    where release.brand_id = target_brand
      and release.archive_object_path = target_prefix || '/archive.zip'
      and release.objects_purged_at is null
      and release.purge_started_at is not null
      and release.purge_claim_id is distinct from p_claim_id
  ) or exists (
    select 1 from public.tenant_package_publications publication
    join public.tenant_package_releases release
      on release.id = publication.current_release_id
    where release.brand_id = target_brand
      and release.archive_object_path = target_prefix || '/archive.zip'
  ) then
    raise exception using errcode = '23514', message = 'tenant_package_cleanup_claim_invalid';
  end if;

  renewed_until := clock_timestamp() + interval '10 minutes';
  update app_private.tenant_package_upload_sessions upload_session set
    purge_lease_until = renewed_until,
    updated_at = statement_timestamp()
  where upload_session.purge_claim_id = p_claim_id;
  update public.tenant_package_releases release set purge_lease_until = renewed_until
  where release.purge_claim_id = p_claim_id;
  return renewed_until;
end $$;
revoke all on function public.renew_tenant_package_purge_claim(uuid)
  from public, anon, authenticated;
grant execute on function public.renew_tenant_package_purge_claim(uuid)
  to service_role;

create or replace function public.confirm_tenant_package_purge_claim(p_claim_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target_brand uuid;
  target_prefix text;
  prior_result boolean;
begin
  if p_claim_id is null then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_claim_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_claim_id::text, 23000)
  );
  select outcome.result into prior_result
  from app_private.tenant_package_purge_claim_outcomes outcome
  where outcome.claim_id = p_claim_id;
  if found then return prior_result; end if;

  select claimed.brand_id, claimed.object_prefix into target_brand, target_prefix
  from (
    select upload_session.brand_id, upload_session.object_prefix
    from app_private.tenant_package_upload_sessions upload_session
    where upload_session.purge_claim_id = p_claim_id
    union all
    select release.brand_id,
      substring(release.archive_object_path from 1
        for length(release.archive_object_path) - 12)
    from public.tenant_package_releases release
    where release.purge_claim_id = p_claim_id
  ) claimed limit 1;
  if target_brand is null then
    raise exception using errcode = '23514', message = 'tenant_package_cleanup_claim_invalid';
  end if;
  perform 1 from public.brands brand where brand.id = target_brand for update;
  perform 1 from app_private.tenant_package_upload_sessions upload_session
  where upload_session.purge_claim_id = p_claim_id for update;
  perform 1 from public.tenant_package_releases release
  where release.purge_claim_id = p_claim_id for update;
  if exists (
    select 1 from app_private.tenant_package_upload_sessions upload_session
    where upload_session.purge_claim_id = p_claim_id
      and upload_session.purge_lease_until <= clock_timestamp()
    union all
    select 1 from public.tenant_package_releases release
    where release.purge_claim_id = p_claim_id
      and release.purge_lease_until <= clock_timestamp()
  ) or exists (
    select 1 from public.tenant_package_publications publication
    join public.tenant_package_releases release
      on release.id = publication.current_release_id
    where release.purge_claim_id = p_claim_id
  ) then
    raise exception using errcode = '23514', message = 'tenant_package_cleanup_claim_invalid';
  end if;
  if not app_private.is_canonical_tenant_package_prefix(target_prefix)
     or exists (
    select 1 from storage.objects object_row
    where object_row.bucket_id = 'tenant-packages'
      and app_private.is_tenant_package_namespace_object(object_row.name, target_prefix)
      and not app_private.is_deletable_tenant_package_object(
        object_row.name, target_prefix
      )
  ) then
    update app_private.tenant_package_upload_sessions upload_session set
      purge_blocked_at = statement_timestamp(),
      purge_blocked_reason = 'noncanonical_objects',
      purge_claim_id = null, purge_lease_until = null,
      updated_at = statement_timestamp()
    where upload_session.purge_claim_id = p_claim_id;
    update public.tenant_package_releases release set
      purge_blocked_at = statement_timestamp(),
      purge_blocked_reason = 'noncanonical_objects',
      purge_claim_id = null, purge_lease_until = null
    where release.purge_claim_id = p_claim_id;
    insert into app_private.tenant_package_purge_claim_outcomes (claim_id, result)
    values (p_claim_id, false);
    return false;
  end if;
  if exists (
    select 1 from storage.objects object_row
    where object_row.bucket_id = 'tenant-packages'
      and app_private.is_tenant_package_namespace_object(object_row.name, target_prefix)
  ) then
    update app_private.tenant_package_upload_sessions upload_session set
      purge_claim_id = null, purge_lease_until = null, updated_at = statement_timestamp()
    where upload_session.purge_claim_id = p_claim_id;
    update public.tenant_package_releases release set
      purge_claim_id = null, purge_lease_until = null
    where release.purge_claim_id = p_claim_id;
    insert into app_private.tenant_package_purge_claim_outcomes (claim_id, result)
    values (p_claim_id, false);
    return false;
  end if;
  update app_private.tenant_package_upload_sessions upload_session set
    status = 'purged', objects_purged_at = statement_timestamp(),
    purge_claim_id = null, purge_lease_until = null, updated_at = statement_timestamp()
  where upload_session.purge_claim_id = p_claim_id;
  update public.tenant_package_releases release set
    objects_purged_at = statement_timestamp(), purge_claim_id = null, purge_lease_until = null
  where release.purge_claim_id = p_claim_id;
  insert into app_private.tenant_package_purge_claim_outcomes (claim_id, result)
  values (p_claim_id, true);
  return true;
end $$;
revoke all on function public.confirm_tenant_package_purge_claim(uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_tenant_package_purge_claim(uuid)
  to service_role;

create or replace function app.assert_tenant_package_upload_sessions()
returns void language plpgsql stable set search_path = '' as $$
declare
  staged_release_index text;
  staged_release_fk boolean;
begin
  perform app.assert_tenant_package_access_integrity();
  select index_row.indexdef into staged_release_index
  from pg_catalog.pg_indexes index_row
  where index_row.schemaname = 'app_private'
    and index_row.tablename = 'tenant_package_upload_sessions'
    and index_row.indexname = 'tenant_package_upload_sessions_staged_release_idx';
  select exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.conrelid =
        'app_private.tenant_package_upload_sessions'::pg_catalog.regclass
      and constraint_row.confrelid =
        'public.tenant_package_releases'::pg_catalog.regclass
      and (select pg_catalog.array_agg(attribute.attname order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
          and attribute.attnum = key_column.attnum)
        = array['staged_release_id', 'brand_id']::name[]
      and (select pg_catalog.array_agg(attribute.attname order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.confkey)
          with ordinality key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.confrelid
          and attribute.attnum = key_column.attnum)
        = array['id', 'brand_id']::name[]
  ) into staged_release_fk;

  if pg_catalog.to_regclass('app_private.tenant_package_upload_sessions') is null
     or pg_catalog.to_regclass('app_private.tenant_package_purge_claim_outcomes') is null
     or not staged_release_fk
     or staged_release_index is null
     or staged_release_index !~ '\(staged_release_id, brand_id\)'
     or pg_catalog.to_regprocedure(
       'app_private.is_canonical_tenant_package_prefix(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.begin_tenant_package_upload(uuid,text,text,text,text,text,text,integer,bigint)'
     ) is null
     or pg_catalog.to_regprocedure('public.renew_tenant_package_upload(uuid)') is null
     or pg_catalog.to_regprocedure(
       'public.renew_tenant_package_purge_claim(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.claim_tenant_package_cleanup_candidates(integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.confirm_tenant_package_purge_claim(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.stage_tenant_package(uuid,text,text,text,text,text,text,integer,bigint,jsonb,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.stage_tenant_package(uuid,text,text,text,text,text,text,integer,bigint,jsonb)'
     ) is not null
     or exists (
       select 1 from pg_catalog.unnest(array[
         'public.begin_tenant_package_upload(uuid,text,text,text,text,text,text,integer,bigint)'::pg_catalog.regprocedure,
         'public.renew_tenant_package_upload(uuid)'::pg_catalog.regprocedure,
         'public.stage_tenant_package(uuid,text,text,text,text,text,text,integer,bigint,jsonb,uuid)'::pg_catalog.regprocedure,
         'public.claim_tenant_package_cleanup_candidates(integer)'::pg_catalog.regprocedure,
         'public.renew_tenant_package_purge_claim(uuid)'::pg_catalog.regprocedure,
         'public.confirm_tenant_package_purge_claim(uuid)'::pg_catalog.regprocedure
       ]) rpc(oid)
       where not pg_catalog.has_function_privilege('service_role', rpc.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('anon', rpc.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', rpc.oid, 'EXECUTE')
          or exists (
            select 1 from pg_catalog.pg_proc procedure_row
            cross join lateral pg_catalog.aclexplode(coalesce(
              procedure_row.proacl,
              pg_catalog.acldefault('f', procedure_row.proowner)
            )) privilege_row
            where procedure_row.oid = rpc.oid
              and privilege_row.grantee = 0
              and privilege_row.privilege_type = 'EXECUTE'
          )
     )
     or exists (
       select 1 from pg_catalog.unnest(array[
         'app_private.tenant_package_upload_sessions'::pg_catalog.regclass,
         'app_private.tenant_package_purge_claim_outcomes'::pg_catalog.regclass
       ]) private_table(oid)
       where pg_catalog.has_table_privilege(
           'service_role', private_table.oid, 'SELECT,INSERT,UPDATE,DELETE'
         )
          or pg_catalog.has_table_privilege(
            'anon', private_table.oid, 'SELECT,INSERT,UPDATE,DELETE'
          )
          or pg_catalog.has_table_privilege(
            'authenticated', private_table.oid, 'SELECT,INSERT,UPDATE,DELETE'
          )
          or exists (
            select 1 from pg_catalog.pg_class table_row
            cross join lateral pg_catalog.aclexplode(coalesce(
              table_row.relacl,
              pg_catalog.acldefault('r', table_row.relowner)
            )) privilege_row
            where table_row.oid = private_table.oid
              and privilege_row.grantee = 0
              and privilege_row.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
          )
     )
     or exists (
       select 1
       from pg_catalog.pg_class sequence_row
       join pg_catalog.pg_depend dependency on dependency.objid = sequence_row.oid
         and dependency.deptype in ('a', 'i')
       where sequence_row.relkind = 'S'
         and dependency.refobjid in (
           'app_private.tenant_package_upload_sessions'::pg_catalog.regclass,
           'app_private.tenant_package_purge_claim_outcomes'::pg_catalog.regclass
         )
         and (pg_catalog.has_sequence_privilege(
              'service_role', sequence_row.oid, 'USAGE,SELECT,UPDATE'
            )
           or pg_catalog.has_sequence_privilege(
              'anon', sequence_row.oid, 'USAGE,SELECT,UPDATE'
            )
           or pg_catalog.has_sequence_privilege(
              'authenticated', sequence_row.oid, 'USAGE,SELECT,UPDATE'
            )
           or exists (
             select 1
             from pg_catalog.aclexplode(coalesce(
               sequence_row.relacl,
               pg_catalog.acldefault('S', sequence_row.relowner)
             )) privilege_row
             where privilege_row.grantee = 0
           ))
     ) then
    raise exception 'tenant package upload session contract is incomplete';
  end if;
end $$;
revoke all on function app.assert_tenant_package_upload_sessions()
  from public, anon, authenticated;
grant execute on function app.assert_tenant_package_upload_sessions() to service_role;

select app.register_release(
  '20260908230000',
  'fence tenant package uploads and bounded namespace cleanup',
  'app.assert_tenant_package_upload_sessions()'::regprocedure
);
