-- Complete the training-to-operations contract. Passing a published lesson can
-- issue the competency that gates tenant operation tasks, without exposing a
-- write-capable RPC to browser roles.

create or replace function public.award_operation_competency(
  target_brand_user uuid,
  target_competency_key text,
  target_action_id uuid,
  target_source text,
  target_reason text,
  target_expires_at timestamptz,
  target_release uuid,
  target_module_slug text,
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
    or target_module_slug is null
    or target_module_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
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
      case when jsonb_typeof(release.manifest -> 'modules') = 'array'
        then release.manifest -> 'modules' else '[]'::jsonb end
    ) module
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(module -> 'lessons') = 'array'
        then module -> 'lessons' else '[]'::jsonb end
    ) lesson
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(lesson -> 'grantsCompetencyKeys') = 'array'
        then lesson -> 'grantsCompetencyKeys' else '[]'::jsonb end
    ) competency_key
    where release.id = target_release
      and release.brand_id = target_member.brand_id
      and release.status = 'published'
      and module ->> 'slug' = target_module_slug
      and lesson ->> 'slug' = target_lesson_slug
      and competency_key = target_competency_key
  ) or not exists (
    select 1 from public.training_lesson_progress progress
    where progress.brand_id = target_member.brand_id
      and progress.brand_user_id = target_member.id
      and progress.release_id = target_release
      and progress.module_slug = target_module_slug
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
      or prior_award.module_slug is distinct from target_module_slug
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
    brand_id, competency_id, brand_user_id, release_id, module_slug, lesson_slug,
    expires_at, award_source, verification_reason, action_id
  ) values (
    target_member.brand_id, target_competency.id, target_member.id, target_release,
    target_module_slug, target_lesson_slug, target_expires_at, 'training', '', target_action_id
  ) returning * into issued_award;
  return issued_award;
end $$;

revoke all on function public.award_operation_competency(
  uuid, text, uuid, text, text, timestamptz, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.award_operation_competency(
  uuid, text, uuid, text, text, timestamptz, uuid, text, text
) to service_role;

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260828152200;
alter function public.platform_release_readiness_20260828152200() set schema app;
revoke all on function app.platform_release_readiness_20260828152200()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828152200() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260828152200() <> '20260828152200' then
    raise exception 'prior release contract is missing';
  end if;
  if to_regprocedure(
    'public.award_operation_competency(uuid,text,uuid,text,text,timestamptz,uuid,text,text)'
  ) is null then
    raise exception 'training competency award contract is missing';
  end if;
  return '20260828163000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
