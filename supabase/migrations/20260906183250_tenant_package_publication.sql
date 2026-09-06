-- Immutable tenant packages. Originals are reachable only through service-side
-- signed URLs; metadata is readable by active owners and authoritative platform
-- admins after RLS re-checks the current brand_users rows.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-packages', 'tenant-packages', false, 1258291200, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.tenant_package_releases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete restrict,
  release_key text not null check (release_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'),
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_commit_sha text not null check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  deployment_commit_sha text check (deployment_commit_sha is null
    or deployment_commit_sha ~ '^[0-9a-f]{40}$'),
  envelope_sha256 text not null check (envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  archive_sha256 text not null check (archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  archive_object_path text not null check (length(archive_object_path) between 16 and 1024),
  file_count integer not null check (file_count between 1 and 100000),
  total_bytes bigint not null check (total_bytes between 1 and 1073741824),
  status text not null default 'verified'
    check (status in ('verified', 'published', 'superseded', 'failed')),
  verified_at timestamptz not null default now(),
  published_at timestamptz,
  superseded_at timestamptz,
  object_retention_until timestamptz,
  objects_purged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (brand_id, release_key),
  unique (brand_id, artifact_digest),
  unique (id, brand_id),
  check ((status = 'published' and published_at is not null) or status <> 'published'),
  check ((status = 'superseded' and superseded_at is not null
    and object_retention_until is not null) or status <> 'superseded')
);

create table public.tenant_package_files (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete restrict,
  package_release_id uuid not null,
  relative_path text not null check (
    length(relative_path) between 1 and 1024
    and relative_path !~ '(^/|\\\\|[[:cntrl:]]|(^|/)\\.{1,2}(/|$))'
  ),
  path_key text not null check (length(path_key) between 1 and 2048),
  content_sha256 text not null check (content_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  mime_type text not null check (mime_type ~ '^[a-z0-9][a-z0-9.+-]+/[a-z0-9][a-z0-9.+-]+$'),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  preview_kind text not null check (preview_kind in ('text', 'raster', 'download')),
  object_path text not null check (length(object_path) between 16 and 1024),
  preview_object_path text check (
    preview_object_path is null or length(preview_object_path) between 16 and 1024
  ),
  preview_content_sha256 text check (
    preview_content_sha256 is null or preview_content_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  preview_mime_type text check (preview_mime_type is null or preview_mime_type = 'image/png'),
  preview_byte_size bigint check (preview_byte_size is null or preview_byte_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  check (
    (preview_kind = 'raster' and preview_object_path is not null
      and preview_content_sha256 is not null and preview_mime_type = 'image/png'
      and preview_byte_size is not null)
    or (preview_kind <> 'raster' and preview_object_path is null
      and preview_content_sha256 is null and preview_mime_type is null
      and preview_byte_size is null)
  ),
  foreign key (package_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  unique (package_release_id, relative_path),
  unique (package_release_id, path_key),
  unique (object_path),
  unique (preview_object_path),
  unique (id, brand_id)
);

create table public.tenant_package_publications (
  brand_id uuid primary key references public.brands (id) on delete restrict,
  current_release_id uuid not null unique,
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  deployment_commit_sha text not null check (deployment_commit_sha ~ '^[0-9a-f]{40}$'),
  published_at timestamptz not null,
  updated_at timestamptz not null default now(),
  foreign key (current_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict
);

create table public.tenant_package_access_events (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands (id) on delete restrict,
  package_release_id uuid not null,
  file_id uuid,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('tree', 'preview', 'file_download', 'archive_download', 'admin_override')),
  outcome text not null check (outcome in ('allowed', 'denied', 'failed')),
  request_id uuid not null,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096
  ),
  occurred_at timestamptz not null default now(),
  foreign key (package_release_id, brand_id)
    references public.tenant_package_releases (id, brand_id) on delete restrict,
  foreign key (file_id, brand_id)
    references public.tenant_package_files (id, brand_id) on delete restrict
);

create table app_private.tenant_package_rate_limits (
  actor_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  scope_key text not null check (scope_key in ('tree', 'preview', 'file_download', 'archive_download')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (actor_id, brand_id, scope_key, window_started_at)
);

create index tenant_package_releases_brand_status_idx
  on public.tenant_package_releases (brand_id, status, published_at desc);
create index tenant_package_files_release_path_idx
  on public.tenant_package_files (package_release_id, relative_path, id);
create index tenant_package_access_retention_idx
  on public.tenant_package_access_events (occurred_at, id);
create index tenant_package_access_brand_idx
  on public.tenant_package_access_events (brand_id, occurred_at desc);
create index tenant_package_rate_limit_expiry_idx
  on app_private.tenant_package_rate_limits (expires_at);

create or replace function app_private.reject_tenant_package_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'tenant_package_event_immutable';
end $$;
create trigger tenant_package_access_events_immutable
before update or delete on public.tenant_package_access_events
for each row execute function app_private.reject_tenant_package_event_mutation();

create or replace function app.can_read_tenant_package(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
    <> '00000000-0000-0000-0000-000000000000'::uuid
    and (
      exists (
        select 1 from public.brand_users membership
        where membership.user_id = (select auth.uid())
          and membership.role = 'platform_admin'::app.brand_role
      )
      or exists (
        select 1 from public.brand_users membership
        join public.brands brand on brand.id = membership.brand_id
        where membership.user_id = (select auth.uid())
          and membership.brand_id = target_brand
          and membership.role = 'brand_owner'::app.brand_role
          and brand.status = 'active'
      )
    )
$$;
revoke all on function app.can_read_tenant_package(uuid) from public, anon;
grant execute on function app.can_read_tenant_package(uuid) to authenticated, service_role;

alter table public.tenant_package_releases enable row level security;
alter table public.tenant_package_files enable row level security;
alter table public.tenant_package_publications enable row level security;
alter table public.tenant_package_access_events enable row level security;
alter table app_private.tenant_package_rate_limits enable row level security;

create policy tenant_package_releases_owner_admin_read
  on public.tenant_package_releases for select to authenticated
  using (app.can_read_tenant_package(brand_id));
create policy tenant_package_files_owner_admin_read
  on public.tenant_package_files for select to authenticated
  using (app.can_read_tenant_package(brand_id));
create policy tenant_package_publications_owner_admin_read
  on public.tenant_package_publications for select to authenticated
  using (app.can_read_tenant_package(brand_id));

revoke all on table public.tenant_package_releases from public, anon, authenticated;
revoke all on table public.tenant_package_files from public, anon, authenticated;
revoke all on table public.tenant_package_publications from public, anon, authenticated;
revoke all on table public.tenant_package_access_events from public, anon, authenticated;
revoke all on table app_private.tenant_package_rate_limits from public, anon, authenticated;
grant select on table public.tenant_package_releases to authenticated;
grant select on table public.tenant_package_files to authenticated;
grant select on table public.tenant_package_publications to authenticated;
grant select, insert, update, delete on table public.tenant_package_releases to service_role;
grant select, insert, update, delete on table public.tenant_package_files to service_role;
grant select, insert, update, delete on table public.tenant_package_publications to service_role;
grant select, insert, update, delete on table public.tenant_package_access_events to service_role;
grant select, insert, update, delete on table app_private.tenant_package_rate_limits to service_role;
grant usage, select on sequence public.tenant_package_access_events_id_seq to service_role;

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
  p_files jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  release_id uuid;
  digest_hex text := substring(p_artifact_digest from 8);
  expected_prefix text := p_brand_id::text || '/' || digest_hex || '/';
begin
  if p_brand_id is null or p_release_key is null or p_artifact_digest is null
     or p_commit_sha is null or p_envelope_sha256 is null or p_archive_sha256 is null
     or p_archive_object_path is null or p_files is null
     or p_release_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'
     or p_artifact_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_commit_sha !~ '^[0-9a-f]{40}$'
     or p_envelope_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_archive_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_file_count is null or p_file_count not between 1 and 100000
     or p_total_bytes is null or p_total_bytes not between 1 and 1073741824
     or p_archive_object_path <> expected_prefix || 'archive.zip' then
    raise exception using errcode = '22023', message = 'tenant_package_invalid';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'tenant_package_invalid';
  end if;
  if jsonb_array_length(p_files) <> p_file_count then
    raise exception using errcode = '22023', message = 'tenant_package_invalid';
  end if;
  perform 1 from public.brands brand
    where brand.id = p_brand_id and brand.status in ('provisioning', 'active') for update;
  if not found then
    raise exception using errcode = '23503', message = 'tenant_package_brand_unavailable';
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_files) item
       where jsonb_typeof(item) is distinct from 'object'
          or jsonb_typeof(item->'byteSize') is distinct from 'number'
          or coalesce(item->>'byteSize', '') !~ '^[0-9]{1,10}$'
          or length(coalesce(item->>'relativePath', '')) not between 1 and 1024
          or item->>'relativePath' ~ '(^/|\\\\|[[:cntrl:]]|(^|/)\\.{1,2}(/|$))'
          or length(coalesce(item->>'pathKey', '')) not between 1 and 1024
          or item->>'pathKey' ~ '(^/|\\\\|[[:cntrl:]]|(^|/)\\.{1,2}(/|$))'
          or coalesce(item->>'contentSha256', '') !~ '^sha256:[0-9a-f]{64}$'
          or coalesce(item->>'mimeType', '') !~ '^[a-z0-9][a-z0-9.+-]+/[a-z0-9][a-z0-9.+-]+$'
          or case when coalesce(item->>'byteSize', '') ~ '^[0-9]{1,10}$'
            then (item->>'byteSize')::bigint else 0 end not between 1 and 104857600
          or coalesce(item->>'previewKind', '') not in ('text', 'raster', 'download')
          or coalesce(item->>'objectPath', '') <> expected_prefix || 'files/' || item->>'pathKey'
          or (item->>'previewKind' = 'raster' and (
            coalesce(item->>'previewObjectPath', '')
              <> expected_prefix || 'previews/' || item->>'pathKey' || '.png'
            or coalesce(item->>'previewContentSha256', '') !~ '^sha256:[0-9a-f]{64}$'
            or item->>'previewMimeType' is distinct from 'image/png'
            or jsonb_typeof(item->'previewByteSize') is distinct from 'number'
            or coalesce(item->>'previewByteSize', '') !~ '^[0-9]{1,8}$'
            or case when coalesce(item->>'previewByteSize', '') ~ '^[0-9]{1,8}$'
              then (item->>'previewByteSize')::bigint else 0 end not between 1 and 10485760
          ))
          or (item->>'previewKind' <> 'raster' and (
            item ? 'previewObjectPath' or item ? 'previewContentSha256'
            or item ? 'previewMimeType' or item ? 'previewByteSize'
          ))
     ) then
    raise exception using errcode = '22023', message = 'tenant_package_file_invalid';
  end if;
  if (select coalesce(sum((item->>'byteSize')::bigint), 0)
      from jsonb_array_elements(p_files) item) <> p_total_bytes then
    raise exception using errcode = '22023', message = 'tenant_package_file_invalid';
  end if;
  if not exists (
    select 1 from storage.objects object_row
    where object_row.bucket_id = 'tenant-packages'
      and object_row.name = p_archive_object_path
  ) or exists (
    select 1 from jsonb_array_elements(p_files) item
    where not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'tenant-packages'
        and object_row.name = item->>'objectPath'
    )
    or (item->>'previewKind' = 'raster' and not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'tenant-packages'
        and object_row.name = item->>'previewObjectPath'
    ))
  ) then
    raise exception using errcode = '23514', message = 'tenant_package_objects_unverified';
  end if;
  insert into public.tenant_package_releases (
    brand_id, release_key, artifact_digest, source_commit_sha, envelope_sha256, archive_sha256,
    archive_object_path, file_count, total_bytes
  ) values (
    p_brand_id, p_release_key, p_artifact_digest, p_commit_sha, p_envelope_sha256, p_archive_sha256,
    p_archive_object_path, p_file_count, p_total_bytes
  ) returning id into release_id;
  insert into public.tenant_package_files (
    brand_id, package_release_id, relative_path, path_key, content_sha256,
    mime_type, byte_size, preview_kind, object_path, preview_object_path,
    preview_content_sha256, preview_mime_type, preview_byte_size
  ) select
    p_brand_id, release_id, item->>'relativePath', item->>'pathKey',
    item->>'contentSha256', item->>'mimeType', (item->>'byteSize')::bigint,
    item->>'previewKind', item->>'objectPath', item->>'previewObjectPath',
    item->>'previewContentSha256', item->>'previewMimeType',
    (item->>'previewByteSize')::bigint
  from jsonb_array_elements(p_files) item;
  perform public.record_organization_readiness(
    p_brand_id, 'tenant_artifacts', true,
    jsonb_build_object('artifactDigest', p_artifact_digest)
  );
  return release_id;
exception when unique_violation then
  select release.id into release_id from public.tenant_package_releases release
  where release.brand_id = p_brand_id
    and release.release_key = p_release_key
    and release.artifact_digest = p_artifact_digest
    and release.source_commit_sha = p_commit_sha
    and release.envelope_sha256 = p_envelope_sha256
    and release.archive_sha256 = p_archive_sha256
    and release.archive_object_path = p_archive_object_path
    and release.file_count = p_file_count
    and release.total_bytes = p_total_bytes;
  if release_id is null then
    raise exception using errcode = '23505', message = 'tenant_package_release_conflict';
  end if;
  return release_id;
end $$;
revoke all on function public.stage_tenant_package(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.stage_tenant_package(
  uuid, text, text, text, text, text, text, integer, bigint, jsonb
) to service_role;

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
  promotion_time timestamptz;
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
  select * into release_row from public.tenant_package_releases release
  where release.brand_id = p_brand_id and release.release_key = p_release_key for update;
  if not found or release_row.status not in ('verified', 'published')
     or release_row.artifact_digest <> p_artifact_digest
     or (release_row.status = 'published'
       and release_row.deployment_commit_sha is distinct from p_commit_sha) then
    raise exception using errcode = '23514', message = 'tenant_package_release_mismatch';
  end if;
  update public.tenant_package_releases release set
    status = 'superseded', superseded_at = now(),
    object_retention_until = now() + interval '1 year'
  where release.brand_id = p_brand_id and release.status = 'published'
    and release.id <> release_row.id;
  update public.tenant_package_releases release set
    status = 'published', published_at = coalesce(release.published_at, now()),
    deployment_commit_sha = p_commit_sha,
    superseded_at = null, object_retention_until = null
  where release.id = release_row.id;
  select release.published_at into promotion_time
  from public.tenant_package_releases release where release.id = release_row.id;
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

create or replace function public.consume_tenant_package_download_budget(
  p_brand_id uuid,
  p_scope_key text
) returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  request_limit integer;
  window_seconds integer;
  window_start timestamptz;
begin
  if actor is null or not app.can_read_tenant_package(p_brand_id) then
    raise exception using errcode = '42501', message = 'tenant_package_not_found';
  end if;
  select limits.request_limit, limits.window_seconds
  into request_limit, window_seconds
  from (values
    ('tree', 240, 60),
    ('preview', 120, 60),
    ('file_download', 30, 60),
    ('archive_download', 5, 3600)
  ) limits(scope_key, request_limit, window_seconds)
  where limits.scope_key = p_scope_key;
  if not found then
    raise exception using errcode = '22023', message = 'tenant_package_scope_invalid';
  end if;
  window_start := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / window_seconds) * window_seconds
  );
  insert into app_private.tenant_package_rate_limits (
    actor_id, brand_id, scope_key, window_started_at, request_count, expires_at
  ) values (
    actor, p_brand_id, p_scope_key, window_start, 1,
    window_start + make_interval(secs => window_seconds)
  ) on conflict (actor_id, brand_id, scope_key, window_started_at)
  do update set request_count = app_private.tenant_package_rate_limits.request_count + 1
  where app_private.tenant_package_rate_limits.request_count < request_limit;
  if not found then
    return query select false, greatest(1, ceil(extract(epoch from
      (window_start + make_interval(secs => window_seconds) - statement_timestamp())))::integer);
  else
    return query select true, 0;
  end if;
end $$;
revoke all on function public.consume_tenant_package_download_budget(uuid, text)
  from public, anon;
grant execute on function public.consume_tenant_package_download_budget(uuid, text)
  to authenticated;

create or replace function public.record_tenant_package_access(
  p_brand_id uuid,
  p_release_id uuid,
  p_file_id uuid,
  p_actor_id uuid,
  p_action text,
  p_outcome text,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent_hash text,
  p_metadata jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare event_id bigint;
begin
  insert into public.tenant_package_access_events (
    brand_id, package_release_id, file_id, actor_id, action, outcome,
    request_id, ip_hash, user_agent_hash, metadata
  ) values (
    p_brand_id, p_release_id, p_file_id, p_actor_id, p_action, p_outcome,
    p_request_id, p_ip_hash, p_user_agent_hash, p_metadata
  ) returning id into event_id;
  return event_id;
end $$;
revoke all on function public.record_tenant_package_access(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_tenant_package_access(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb
) to service_role;

create or replace function public.list_tenant_package_cleanup_candidates(p_limit integer default 500)
returns table (object_path text, release_id uuid, reason text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_limit_invalid';
  end if;
  return query
  with known_objects as (
    select release.archive_object_path as path, release.id, release.object_retention_until
    from public.tenant_package_releases release
    union all
    select file.object_path, release.id, release.object_retention_until
    from public.tenant_package_files file
    join public.tenant_package_releases release on release.id = file.package_release_id
    union all
    select file.preview_object_path, release.id, release.object_retention_until
    from public.tenant_package_files file
    join public.tenant_package_releases release on release.id = file.package_release_id
    where file.preview_object_path is not null
  )
  select object_row.name, known.id,
    case when known.path is null then 'orphan' else 'retention_expired' end
  from storage.objects object_row
  left join known_objects known on known.path = object_row.name
  left join public.tenant_package_publications publication
    on publication.current_release_id = known.id
  where object_row.bucket_id = 'tenant-packages'
    and (
      (known.path is null and object_row.created_at < now() - interval '24 hours')
      or (known.object_retention_until <= now() and publication.current_release_id is null)
    )
  order by object_row.created_at, object_row.name
  limit p_limit;
end $$;
revoke all on function public.list_tenant_package_cleanup_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.list_tenant_package_cleanup_candidates(integer) to service_role;

create or replace function public.confirm_tenant_package_object_purge(p_release_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  if coalesce(cardinality(p_release_ids), 0) > 1000 then
    raise exception using errcode = '22023', message = 'tenant_package_cleanup_limit_invalid';
  end if;
  update public.tenant_package_releases release set objects_purged_at = now()
  where release.id = any(coalesce(p_release_ids, '{}'::uuid[]))
    and release.status = 'superseded'
    and release.object_retention_until <= now()
    and not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'tenant-packages'
        and (object_row.name = release.archive_object_path or exists (
          select 1 from public.tenant_package_files file
          where file.package_release_id = release.id
            and object_row.name in (file.object_path, file.preview_object_path)
        ))
    );
  get diagnostics updated_count = row_count;
  return updated_count;
end $$;
revoke all on function public.confirm_tenant_package_object_purge(uuid[])
  from public, anon, authenticated;
grant execute on function public.confirm_tenant_package_object_purge(uuid[]) to service_role;

-- No storage.objects policies are added for tenant-packages. Only the service
-- role can upload, verify, sign, or remove immutable originals.
