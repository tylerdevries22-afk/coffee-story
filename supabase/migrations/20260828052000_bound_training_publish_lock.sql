-- A disconnected PostgREST client can leave a pooled session holding the
-- previous blocking advisory lock until that backend is recycled. Publishing
-- must fail fast so one abandoned request cannot stall a tenant indefinitely.
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

  if jsonb_typeof(selected.manifest) <> 'object'
     or selected.manifest->>'schemaVersion' <> '2'
     or jsonb_typeof(selected.manifest->'modules') <> 'array'
     or jsonb_array_length(selected.manifest->'modules') < 5
     or jsonb_array_length(selected.manifest->'modules') > 16
     or jsonb_typeof(selected.manifest->'sources') <> 'array'
     or jsonb_array_length(selected.manifest->'sources') < 3
     or jsonb_array_length(selected.manifest->'sources') > 12
     or jsonb_typeof(selected.answer_key) <> 'object' then
    raise exception using errcode = '22023', message = 'training_manifest_not_publishable';
  end if;

  select count(distinct module.value->>'trackKey') into core_count
  from jsonb_array_elements(selected.manifest->'modules') module
  where module.value->>'trackKey' in ('knowledge', 'skills', 'service', 'safety', 'operations');
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
