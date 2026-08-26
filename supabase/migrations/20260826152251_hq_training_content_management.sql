-- Tenant-owner authoring metadata and atomic manual publication for the HQ
-- content workspace. Public manifests remain answer-free; only the server-side
-- HQ action can read answer_key and invoke the publication function.

alter table public.training_releases
  add column created_by uuid,
  add column updated_by uuid,
  add foreign key (created_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (created_by),
  add foreign key (updated_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (updated_by);

create index training_releases_created_by_idx
  on public.training_releases (created_by) where created_by is not null;
create index training_releases_updated_by_idx
  on public.training_releases (updated_by) where updated_by is not null;

-- Preserve every older draft while making the newest one the editable draft.
-- `failed` is intentionally used rather than delete/retire: no authored work is
-- discarded and retired releases keep their published-at invariant.
with ranked as (
  select id, row_number() over (
    partition by brand_id order by updated_at desc, created_at desc, id desc
  ) as position
  from public.training_releases
  where status = 'draft'
)
update public.training_releases release
set status = 'failed', updated_at = now()
from ranked
where release.id = ranked.id and ranked.position > 1;

create unique index training_releases_one_draft_idx
  on public.training_releases (brand_id) where status = 'draft';

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
  -- JavaScript database drivers normalize timestamps to milliseconds, while
  -- Postgres stores microseconds. Compare at the precision every supported HQ
  -- client can faithfully round-trip so an unchanged draft is not rejected.
  if date_trunc('milliseconds', selected.updated_at)
     is distinct from date_trunc('milliseconds', expected_updated_at) then
    raise exception using errcode = '40001', message = 'training_draft_stale';
  end if;
  if jsonb_typeof(selected.manifest) <> 'object'
     or jsonb_typeof(selected.manifest->'modules') <> 'array'
     or jsonb_array_length(selected.manifest->'modules') < 2
     or jsonb_array_length(selected.manifest->'modules') > 8
     or jsonb_typeof(selected.manifest->'sources') <> 'array'
     or jsonb_array_length(selected.manifest->'sources') < 3
     or jsonb_array_length(selected.manifest->'sources') > 12
     or jsonb_typeof(selected.answer_key) <> 'object' then
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

comment on function public.publish_manual_training_release(
  uuid, uuid, uuid, timestamptz
) is 'Atomically promotes one owner-authored training draft without exposing answer keys.';

-- Keep deep health aligned with the feature contract shipped by this release.
-- A database that can accept orders but cannot publish HQ-authored training is
-- not ready for this version of the console.
create or replace function public.platform_release_readiness()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'commit_order'
      and procedure.pronargs = 18
  ) then
    raise exception 'required order commit contract is missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'publish_manual_training_release'
      and procedure.pronargs = 4
  ) then
    raise exception 'required HQ training publication contract is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) or not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_change_signals'
  ) then
    raise exception 'required order realtime publication is missing';
  end if;
  return '20260826152251';
end $$;
