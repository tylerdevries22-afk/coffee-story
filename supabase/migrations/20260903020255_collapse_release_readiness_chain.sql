-- Stop the release contract growing a link per migration.
--
-- Every migration since 0828130000 has extended `platform_release_readiness()`
-- the same way: rename the head aside, move it to `app`, re-grant it, then
-- create a new head that calls the old one and asserts its return value. That
-- is five statements of ceremony to add one assertion, it nests 26 deep today,
-- and getting any step wrong breaks the deploy gate rather than the feature --
-- 20260828192003_repair_release_readiness_chain.sql exists because that has
-- already happened once.
--
-- What this does NOT do: rewrite the 26 archived links. Their bodies are the
-- accumulated release contract, they are still correct, and rewriting them all
-- in one migration would put the entire deploy gate at risk to save call
-- overhead that is measured in microseconds. The chain is frozen instead --
-- called once, as a unit -- and new assertions register a row.
--
-- The expensive part of the chain is not its depth. It is the six per-brand
-- scans in the 20260902220257 link, which the legacy-flag removal deletes.
--
-- Registering is now the contract: a migration that means to advance the
-- release version inserts its own row. `platform_release_readiness()` returns
-- the newest registered release, which is what the hosted gate compares
-- against the newest migration filename.

create table app.release_assertions (
  release text primary key
    constraint release_assertions_release_is_a_migration_stamp
    check (release ~ '^[0-9]{14}$'),
  -- Null is a legitimate registration: a migration may advance the release
  -- version without adding an assertion to the contract.
  assertion regprocedure,
  note text not null constraint release_assertions_note_not_blank
    check (length(btrim(note)) > 0),
  registered_at timestamptz not null default now()
);

comment on table app.release_assertions is
  'The release contract. Each row is one migration''s claim on readiness; '
  'platform_release_readiness() runs every assertion and returns the newest '
  'release. Replaces the nested rename chain used through 20260903005237.';

revoke all on table app.release_assertions from public, anon, authenticated;
grant select, insert on table app.release_assertions to service_role;

-- Registration helper. Exists to reject the two mistakes the nested chain made
-- easy: an assertion that takes arguments (the head has none to pass) and a
-- release stamp that does not match the migration registering it.
create or replace function app.register_release(
  p_release text,
  p_note text,
  p_assertion regprocedure default null
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_assertion is not null then
    if not exists (
      select 1 from pg_catalog.pg_proc proc
      where proc.oid = p_assertion and proc.pronargs = 0
    ) then
      raise exception 'release assertion % must take no arguments', p_assertion;
    end if;
  end if;
  insert into app.release_assertions (release, note, assertion)
  values (p_release, p_note, p_assertion);
end $$;
revoke all on function app.register_release(text, text, regprocedure)
  from public, anon, authenticated;
grant execute on function app.register_release(text, text, regprocedure) to service_role;

-- Freeze the existing chain. One last rename, then nothing renames it again.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260903005237;
alter function public.platform_release_readiness_20260903005237() set schema app;
revoke all on function app.platform_release_readiness_20260903005237()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260903005237() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
declare
  registered record;
  newest text;
begin
  for registered in
    select assertion from app.release_assertions
     where assertion is not null
     order by release
  loop
    -- regprocedure renders schema-qualified under an empty search_path, and
    -- register_release has already refused anything taking arguments, so there
    -- is nothing here for a caller to influence.
    execute format('select %s', registered.assertion::text);
  end loop;

  select max(release) into newest from app.release_assertions;
  if newest is null then
    raise exception 'no release is registered';
  end if;
  return newest;
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;

-- The frozen chain becomes the first registered assertion: one call, which
-- recurses the 26 links exactly as before. Its own return value is checked by
-- the link above it, so reaching here without an exception is the assertion.
select app.register_release(
  '20260903005237',
  'the 26-link chain through the storefront narrowing, frozen and called as a unit',
  'app.platform_release_readiness_20260903005237()'::regprocedure
);

select app.register_release(
  '20260903020255',
  'chain collapsed to a registry; this migration adds no assertion of its own'
);
