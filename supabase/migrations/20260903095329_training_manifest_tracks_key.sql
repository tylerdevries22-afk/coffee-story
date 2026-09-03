-- Teach the three server-side manifest readers the schema-3 spelling before any
-- writer emits it.
--
-- 20260903041500 renamed the progress columns to track_slug and left a note:
-- "`module` stays the name of the manifest node it iterates. The manifest key
-- is `modules` until a later phase renames it." This is that phase. Schema 3
-- moves the array from `modules` to `tracks` and drops the per-node `trackKey`,
-- because the slug was already the identity everywhere that persists --
-- training_lesson_progress.track_slug, the answer key, the operator URL, and
-- the `module ->> 'slug'` match in award_operation_competency below all key on
-- it, and nothing keyed on trackKey.
--
-- Order matters and this migration has to land first. All three functions
-- below read `manifest -> 'modules'` today, and one of them additionally requires
-- schemaVersion = '2' and counts five distinct `trackKey` values. Publish a
-- schema-3 draft against them and publish_manual_training_release raises
-- training_manifest_not_publishable for a manifest that is completely valid,
-- while award_operation_competency stops finding the lesson and every passed
-- quiz raises training_competency_progress_invalid. Both are silent in the
-- sense that matters: the release looks fine, the operator sees a generic
-- failure, and nothing distinguishes it from an outage.
--
-- Every reader therefore accepts either spelling rather than switching. A
-- release published last week is still the live one for its tenant, and its
-- manifest is immutable -- there is no backfill that would let this be a
-- clean cutover, and no reason to want one.
--
-- Lock: three CREATE OR REPLACE FUNCTION statements. No table is touched.

-- Reads coalesce(tracks, modules) and accepts schemaVersion 2 or 3. The core
-- count comes from coalesce(trackKey, slug): a schema-2 node still carries
-- trackKey and may disagree with its slug, a schema-3 node has only the slug,
-- and a schema-2 node marked 'custom' matches neither list, which is right.
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
  tracks jsonb;
  core_count integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended(target_brand::text, 0)) then
    raise exception using errcode = '55P03', message = 'training_publish_busy';
  end if;

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
    -- 40001 is reserved for serialization failures and hosted gateways may
    -- retry it automatically. This is an application-level version conflict.
    raise exception using errcode = 'P0001', message = 'training_draft_stale';
  end if;

  if jsonb_typeof(selected.manifest) = 'object' then
    tracks := coalesce(selected.manifest -> 'tracks', selected.manifest -> 'modules');
  end if;

  -- `is distinct from` rather than `<>`: a manifest carrying neither key leaves
  -- `tracks` null, and a null in the middle of this chain would make the whole
  -- condition null, which `if` treats as false. That fails open.
  if jsonb_typeof(selected.manifest) is distinct from 'object'
     or coalesce(selected.manifest->>'schemaVersion', '') not in ('2', '3')
     or jsonb_typeof(tracks) is distinct from 'array'
     or jsonb_array_length(tracks) < 5
     or jsonb_array_length(tracks) > 16
     or jsonb_typeof(selected.manifest->'sources') <> 'array'
     or jsonb_array_length(selected.manifest->'sources') < 3
     or jsonb_array_length(selected.manifest->'sources') > 12
     or jsonb_typeof(selected.answer_key) <> 'object' then
    raise exception using errcode = '22023', message = 'training_manifest_not_publishable';
  end if;

  select count(distinct coalesce(track.value->>'trackKey', track.value->>'slug'))
    into core_count
  from jsonb_array_elements(tracks) track
  where coalesce(track.value->>'trackKey', track.value->>'slug')
    in ('knowledge', 'skills', 'service', 'safety', 'operations');
  if core_count <> 5 then
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

comment on function public.publish_manual_training_release(uuid, uuid, uuid, timestamptz) is
  'Atomically publishes a validated training draft and fails fast when the tenant publication lock is busy.';

-- Identical body to 20260903041500 apart from the array lookup and the loop
-- variable's name. The signature is untouched: the readiness link archived as
-- app.platform_release_readiness_20260828163000 asserts this function through
-- to_regprocedure() on the exact argument list, so the parameter list may not
-- move even by one type.
create or replace function public.award_operation_competency(
  target_brand_user uuid,
  target_competency_key text,
  target_action_id uuid,
  target_source text,
  target_reason text,
  target_expires_at timestamptz,
  target_release uuid,
  target_track_slug text,
  target_lesson_slug text
) returns public.training_competency_awards
language plpgsql security invoker set search_path = '' as $$
declare
  target_member public.brand_users;
  target_competency public.training_competencies;
  prior_award public.training_competency_awards;
  issued_award public.training_competency_awards;
begin
  if target_action_id is null
    or target_competency_key is null
    or target_competency_key !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or target_source is distinct from 'training'
    or nullif(btrim(coalesce(target_reason, '')), '') is not null
    or target_release is null
    or target_expires_at is null
    or target_expires_at <= now()
    or target_expires_at > now() + interval '3650 days'
    or target_track_slug is null
    or target_track_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or target_lesson_slug is null
    or target_lesson_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'training_competency_award_invalid';
  end if;

  select member.* into target_member
  from public.brand_users member
  where member.id = target_brand_user;
  if not found then
    raise exception using errcode = '22023', message = 'training_competency_member_invalid';
  end if;

  select competency.* into target_competency
  from public.training_competencies competency
  where competency.brand_id = target_member.brand_id
    and competency.competency_key = target_competency_key
    and competency.is_active;
  if not found then
    raise exception using errcode = '22023', message = 'training_competency_unavailable';
  end if;

  if not exists (
    select 1
    from public.training_releases release
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(coalesce(release.manifest -> 'tracks', release.manifest -> 'modules')) = 'array'
        then coalesce(release.manifest -> 'tracks', release.manifest -> 'modules') else '[]'::jsonb end
    ) track
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(track -> 'lessons') = 'array'
        then track -> 'lessons' else '[]'::jsonb end
    ) lesson
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(lesson -> 'grantsCompetencyKeys') = 'array'
        then lesson -> 'grantsCompetencyKeys' else '[]'::jsonb end
    ) competency_key
    where release.id = target_release
      and release.brand_id = target_member.brand_id
      and release.status = 'published'
      and track ->> 'slug' = target_track_slug
      and lesson ->> 'slug' = target_lesson_slug
      and competency_key = target_competency_key
  ) or not exists (
    select 1 from public.training_lesson_progress progress
    where progress.brand_id = target_member.brand_id
      and progress.brand_user_id = target_member.id
      and progress.release_id = target_release
      and progress.track_slug = target_track_slug
      and progress.lesson_slug = target_lesson_slug
      and progress.status = 'completed'
  ) then
    raise exception using errcode = '22023', message = 'training_competency_progress_invalid';
  end if;

  -- Serialize both the idempotency key and the active award. The first lock
  -- turns concurrent action-ID misuse into a deterministic conflict instead
  -- of leaking the unique-index error; the second preserves one active award.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    target_member.brand_id::text || ':' || target_action_id::text,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    target_member.brand_id::text || ':' || target_member.id::text || ':' || target_competency.id::text,
    0
  ));

  select award.* into prior_award
  from public.training_competency_awards award
  where award.brand_id = target_member.brand_id
    and award.action_id = target_action_id;
  if found then
    if prior_award.brand_user_id <> target_member.id
      or prior_award.competency_id <> target_competency.id
      or prior_award.release_id is distinct from target_release
      or prior_award.track_slug is distinct from target_track_slug
      or prior_award.lesson_slug is distinct from target_lesson_slug
      or prior_award.award_source <> 'training' then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return prior_award;
  end if;

  update public.training_competency_awards
  set revoked_at = now(), revocation_reason = 'superseded'
  where competency_id = target_competency.id
    and brand_user_id = target_member.id
    and revoked_at is null;

  insert into public.training_competency_awards (
    brand_id, competency_id, brand_user_id, release_id, track_slug, lesson_slug,
    expires_at, award_source, verification_reason, action_id
  ) values (
    target_member.brand_id, target_competency.id, target_member.id, target_release,
    target_track_slug, target_lesson_slug, target_expires_at, 'training', '', target_action_id
  ) returning * into issued_award;
  return issued_award;
end $$;

-- CREATE OR REPLACE keeps the existing ACL; restated for the same reason
-- 20260903041500 restated it.
revoke all on function public.award_operation_competency(
  uuid, text, uuid, text, text, timestamptz, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.award_operation_competency(
  uuid, text, uuid, text, text, timestamptz, uuid, text, text
) to service_role;

-- The third reader, and the one that fails most quietly. This trigger is what
-- fills content_media_versions, so a draft saved under `tracks` would record
-- no artwork or lesson-media history at all: the save succeeds, the editor's
-- "Artwork history" panel is simply empty, and nothing anywhere reports why.
--
-- `entity_type` stays 'training_module' and 'training_lesson'. Those are
-- schema literals shared with the catalog tables and a CHECK constraint, not
-- the manifest's vocabulary -- `docs/ARCHITECTURE.md` ("Vocabulary") lists
-- them as a third meaning of the word. Renaming them is a different change
-- with a different blast radius.
create or replace function app.capture_training_media_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  editor uuid;
begin
  if tg_op = 'UPDATE' and new.manifest is not distinct from old.manifest then return new; end if;

  select member.id into editor
  from public.brand_users member
  where member.brand_id = new.brand_id
    and member.user_id = (select auth.uid())
  limit 1;

  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, public_url, created_by,
    storage_bucket, object_path, metadata
  )
  select
    new.brand_id,
    'training',
    'training_module',
    track.value ->> 'slug',
    'icon',
    track.value -> 'icon' ->> 'url',
    coalesce(new.updated_by, editor),
    case when position('/storage/v1/object/public/training-media/' in (track.value -> 'icon' ->> 'url')) > 0 then 'training-media' end,
    case when position('/storage/v1/object/public/training-media/' in (track.value -> 'icon' ->> 'url')) > 0
      then split_part(track.value -> 'icon' ->> 'url', '/storage/v1/object/public/training-media/', 2) end,
    jsonb_build_object('releaseId', new.id, 'version', new.version)
  from jsonb_array_elements(coalesce(new.manifest -> 'tracks', new.manifest -> 'modules', '[]'::jsonb)) track
  where track.value -> 'icon' ->> 'url' ~ '^https://'
  on conflict do nothing;

  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, public_url, created_by,
    storage_bucket, object_path, metadata
  )
  select
    new.brand_id,
    'training',
    'training_lesson',
    concat(track.value ->> 'slug', '/', lesson.value ->> 'slug'),
    concat('lesson-media:', media.ordinality),
    media.value ->> 'url',
    coalesce(new.updated_by, editor),
    case when position('/storage/v1/object/public/training-media/' in (media.value ->> 'url')) > 0 then 'training-media' end,
    case when position('/storage/v1/object/public/training-media/' in (media.value ->> 'url')) > 0
      then split_part(media.value ->> 'url', '/storage/v1/object/public/training-media/', 2) end,
    jsonb_build_object(
      'releaseId', new.id,
      'version', new.version,
      'kind', media.value ->> 'kind',
      'title', media.value ->> 'title'
    )
  from jsonb_array_elements(coalesce(new.manifest -> 'tracks', new.manifest -> 'modules', '[]'::jsonb)) track
  cross join lateral jsonb_array_elements(coalesce(track.value -> 'lessons', '[]'::jsonb)) lesson
  cross join lateral jsonb_array_elements(coalesce(lesson.value -> 'media', '[]'::jsonb))
    with ordinality media(value, ordinality)
  where media.value ->> 'url' ~ '^https://'
  on conflict do nothing;

  return new;
end $$;

revoke all on function app.capture_training_media_versions() from public;

-- No assertion of its own: the three functions are already asserted by the
-- links that introduced them, and no signature changed.
select app.register_release(
  '20260903095329',
  'training manifest readers accept the schema 3 tracks key alongside modules'
);
