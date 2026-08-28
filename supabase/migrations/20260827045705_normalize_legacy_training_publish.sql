-- Preserve the v1 authoring contract while storing every newly published
-- release as a v2 manifest. Older HQ drafts can be promoted safely: their
-- modules are assigned a track, missing core shells are made explicit, and
-- operators still receive the canonical five-track shape.
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
  resolved_manifest jsonb;
  resolved_modules jsonb;
  module jsonb;
  track text;
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

  if jsonb_typeof(selected.manifest) <> 'object' then
    raise exception using errcode = '22023', message = 'training_manifest_not_publishable';
  end if;
  resolved_manifest := selected.manifest;

  if selected.manifest->>'schemaVersion' = '1'
     and jsonb_typeof(selected.manifest->'modules') = 'array' then
    resolved_modules := '[]'::jsonb;
    for module in select value from jsonb_array_elements(selected.manifest->'modules') loop
      track := nullif(module->>'trackKey', '');
      if track is null then track := nullif(module->>'slug', ''); end if;
      if track in ('knowledge', 'skills', 'service', 'safety', 'operations') then
        module := module || jsonb_build_object('trackKey', track);
      else
        module := module || jsonb_build_object('trackKey', 'custom');
      end if;
      module := module || jsonb_build_object('sortOrder', jsonb_array_length(resolved_modules));
      resolved_modules := resolved_modules || jsonb_build_array(module);
    end loop;

    foreach track in array ARRAY['knowledge', 'skills', 'service', 'safety', 'operations'] loop
      if not exists (
        select 1 from jsonb_array_elements(resolved_modules) existing
        where existing->>'trackKey' = track
      ) then
        resolved_modules := resolved_modules || jsonb_build_array(jsonb_build_object(
          'slug', track,
          'trackKey', track,
          'sortOrder', jsonb_array_length(resolved_modules),
          'title', initcap(track),
          'summary', 'No lessons published yet.',
          'lessons', '[]'::jsonb
        ));
      end if;
    end loop;
    resolved_manifest := resolved_manifest || jsonb_build_object(
      'schemaVersion', 2,
      'modules', resolved_modules
    );
  end if;

  if resolved_manifest->>'schemaVersion' <> '2'
     or jsonb_typeof(resolved_manifest->'modules') <> 'array'
     or jsonb_array_length(resolved_manifest->'modules') < 5
     or jsonb_array_length(resolved_manifest->'modules') > 16
     or jsonb_typeof(resolved_manifest->'sources') <> 'array'
     or jsonb_array_length(resolved_manifest->'sources') < 3
     or jsonb_array_length(resolved_manifest->'sources') > 12
     or jsonb_typeof(selected.answer_key) <> 'object' then
    raise exception using errcode = '22023', message = 'training_manifest_not_publishable';
  end if;

  select count(distinct module.value->>'trackKey') into core_count
  from jsonb_array_elements(resolved_manifest->'modules') module
  where module.value->>'trackKey' in ('knowledge', 'skills', 'service', 'safety', 'operations');
  if core_count <> 5 then
    raise exception using errcode = '22023', message = 'training_manifest_not_publishable';
  end if;

  update public.training_releases
  set status = 'retired', updated_at = now()
  where brand_id = target_brand and status = 'published';

  update public.training_releases
  set status = 'published', manifest = resolved_manifest,
      validated_at = now(), published_at = now(), updated_at = now(), updated_by = target_editor
  where id = target_release and brand_id = target_brand;
  return target_release;
end $$;

revoke all on function public.publish_manual_training_release(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_manual_training_release(
  uuid, uuid, uuid, timestamptz
) to service_role;
