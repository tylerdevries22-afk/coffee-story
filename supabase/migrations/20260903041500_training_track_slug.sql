-- Training progress keys on the track, not the module.
--
-- The published manifest has called these nodes tracks since 20260827045705
-- normalized legacy publishing, and 20260902083817 gave `module` a second,
-- unrelated meaning: the entitlement a brand installs. Three tables still
-- record a member's training against `module_slug`, so the same word names two
-- things that have nothing to do with each other.
--
-- One transaction, no dual-column window. app.enforce_training_attempt_limit()
-- reads the column twice -- once to build the advisory lock key, once in the
-- COUNT that enforces the five-attempt cap and the ten-second floor. Adding
-- track_slug alongside would leave the trigger counting module_slug while
-- inserts populate track_slug, so prior_count is 0 for every attempt and both
-- limits come off in silence: no error, no log line, unlimited quiz retries
-- against a known answer key. There are no rows to migrate, so the window that
-- would normally justify that risk buys nothing here.
--
-- Lock: ACCESS EXCLUSIVE on three tables, held for a catalog update only --
-- renaming a column rewrites no heap pages. Under 10 ms against the 0 rows
-- these tables hold today.

alter table public.training_lesson_progress
  rename column module_slug to track_slug;
alter table public.training_lesson_progress
  rename constraint training_lesson_progress_module_slug_check
  to training_lesson_progress_track_slug_check;

-- The unique key (brand_id, release_id, brand_user_id, track_slug,
-- lesson_slug) follows the column and needs no restatement. Its name is left
-- alone because PostgreSQL truncated the generated one to 63 bytes and it came
-- out as training_lesson_progress_brand_id_release_id_brand_user_id__key --
-- cut off two columns short of this one, so the old word is not in it.

alter table public.training_quiz_attempts
  rename column module_slug to track_slug;
alter table public.training_quiz_attempts
  rename constraint training_quiz_attempts_module_slug_check
  to training_quiz_attempts_track_slug_check;

-- Nullable and unconstrained since 20260828000000: an award may be granted by
-- a manager rather than earned from a lesson, and then there is no track.
alter table public.training_competency_awards
  rename column module_slug to track_slug;

-- Replaced rather than left alone: a plpgsql body is parsed on first execution,
-- so one still naming module_slug would not fail now -- it would fail on the
-- next quiz attempt, which is the path that is supposed to be protected.
--
-- brand_id joins the lock key while the key is being rewritten anyway. The
-- COUNT below has always been brand-scoped, and brand_user_id is only unique
-- within a brand, so the key and the predicate disagreed about what identifies
-- an attempt. That was contention rather than corruption -- two brands could
-- serialize against each other for no reason -- but a lock that guards a count
-- should be keyed on exactly what the count reads.
create or replace function app.enforce_training_attempt_limit() returns trigger
language plpgsql set search_path = '' as $$
declare
  prior_count integer;
  prior_created_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.brand_id::text || ':' || new.brand_user_id::text || ':'
      || new.release_id::text || ':' || new.track_slug || ':' || new.lesson_slug,
    0
  ));
  if exists (select 1 from public.training_quiz_attempts where id = new.id) then
    return new;
  end if;
  select count(*), max(created_at) into prior_count, prior_created_at
  from public.training_quiz_attempts
  where brand_id = new.brand_id
    and release_id = new.release_id
    and brand_user_id = new.brand_user_id
    and track_slug = new.track_slug
    and lesson_slug = new.lesson_slug;
  if prior_count >= 5 then
    raise exception using errcode = 'P0001', message = 'training_attempt_limit_reached';
  end if;
  if prior_created_at is not null and prior_created_at > now() - interval '10 seconds' then
    raise exception using errcode = 'P0001', message = 'training_attempt_rate_limited';
  end if;
  return new;
end $$;

-- The awards path reads training_lesson_progress and writes
-- training_competency_awards, so it has to move in the same transaction as the
-- columns or a passed lesson stops issuing its competency.
--
-- The parameter is renamed too; the signature is not. The readiness link
-- archived as app.platform_release_readiness_20260828163000 asserts this
-- function through to_regprocedure() on the exact argument list
-- (uuid,text,uuid,text,text,timestamptz,uuid,text,text). Parameter names are
-- not part of that identity, but the order and the types are: reorder or add
-- one and every deep health probe starts answering 503.
--
-- `module` stays the name of the manifest node it iterates. The manifest key
-- is `modules` until a later phase renames it, and an alias that disagreed
-- with the JSON it reads would be the harder thing to follow.
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
      and module ->> 'slug' = target_track_slug
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

-- CREATE OR REPLACE keeps the existing ACL, so these restate what
-- 20260828163000 already granted. Restated anyway: the grant is the reason a
-- browser role cannot mint itself a competency, and it should be readable in
-- the migration that last touched the function.
revoke all on function public.award_operation_competency(
  uuid, text, uuid, text, text, timestamptz, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.award_operation_competency(
  uuid, text, uuid, text, text, timestamptz, uuid, text, text
) to service_role;

-- No assertion of its own. A rename either committed with this transaction or
-- did not happen at all, so there is no partial state for the readiness
-- contract to catch, and the function this migration replaces is already
-- asserted by the 20260828163000 link.
select app.register_release(
  '20260903041500',
  'training progress, quiz attempts and competency awards key on track_slug'
);
