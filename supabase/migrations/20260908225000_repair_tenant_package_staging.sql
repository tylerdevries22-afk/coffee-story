-- Repair the staged package validator without rewriting the earlier release.
-- PostgreSQL parses the JSON extraction beside concatenation as a text ->>
-- operation unless the extraction is grouped explicitly.
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
  expected_prefix text := p_brand_id::text || '/' || digest_hex
    || '/' || substring(p_envelope_sha256 from 8) || '/';
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
          or coalesce(item->>'objectPath', '') <> expected_prefix || 'files/' || (item->>'pathKey')
          or (item->>'previewKind' = 'raster' and (
            coalesce(item->>'previewObjectPath', '')
              <> expected_prefix || 'previews/' || (item->>'pathKey') || '.png'
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

create or replace function app.assert_tenant_package_stage_boundary()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  perform app.assert_tenant_package_foreign_key_indexes();
  if pg_catalog.to_regprocedure(
    'public.stage_tenant_package(uuid,text,text,text,text,text,text,integer,bigint,jsonb)'
  ) is null then
    raise exception 'tenant package staging function is missing';
  end if;
end
$$;

revoke all on function app.assert_tenant_package_stage_boundary()
  from public, anon, authenticated;
grant execute on function app.assert_tenant_package_stage_boundary()
  to service_role;

select app.register_release(
  '20260908225000',
  'repair tenant package staging validation',
  'app.assert_tenant_package_stage_boundary()'::regprocedure
);
