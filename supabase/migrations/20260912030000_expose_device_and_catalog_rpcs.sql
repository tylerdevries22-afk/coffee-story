-- PostgREST only resolves an RPC call against the schemas config.toml
-- exposes -- `["public", "storage"]` (supabase/config.toml:20), by design:
-- `app` holds helpers meant for RLS policies and the auth hook, never the
-- REST surface. Five functions were written straight into `app` anyway, and
-- five callers dial them unqualified through supabase-js `.rpc(name, ...)`,
-- which always resolves against the EXPOSED schemas -- so every one of these
-- calls resolves in `public`, finds nothing, and PostgREST returns PGRST202:
--   apps/hq/lib/device-wall-actions.ts:65 and
--     apps/hq/app/api/device-wall/installations/[id]/route.ts:34
--       -> app.revoke_device_installation   (20260902021857:305)
--   apps/hq/app/api/device-wall/heartbeat/route.ts
--       -> app.record_device_heartbeat      (20260902021857:286)
--   apps/hq/lib/device-wall-streams.ts
--       -> app.create_device_stream_session (20260902021857:246)
--   apps/hq/app/(console)/kiosk-flow/actions.ts
--       -> app.set_brand_kiosk_config       (20260722000037:28)
--   apps/hq/app/(console)/content/menu-publishing-actions.ts
--       -> app.publish_catalog_draft        (20260827214924:393)
-- The worst is the first: an owner cannot revoke a stolen wall tablet, and
-- the app can only show "that installation is unavailable" -- the same
-- message a real conflict produces, which is exactly the kind of failure
-- that goes unreported for a day because nothing LOOKS broken.
--
-- The fix is a name, not a rewrite. Each `app.<name>` keeps its validation,
-- its SECURITY setting, its search_path and its own grants untouched; a thin
-- `public.<name>` wrapper with an IDENTICAL signature is the only new
-- surface, and it carries the SAME grants as the function it delegates to --
-- never wider. Moving the bodies into `public` was rejected: that duplicates
-- five non-trivial functions instead of naming one, and every future edit to
-- them would need to happen twice or the copies drift.

create or replace function public.revoke_device_installation(
  p_installation_id uuid, p_brand_id uuid
) returns boolean
language sql security definer set search_path = '' as $$
  select app.revoke_device_installation(p_installation_id, p_brand_id);
$$;
revoke all on function public.revoke_device_installation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_device_installation(uuid, uuid) to service_role;

create or replace function public.record_device_heartbeat(
  p_installation_id uuid, p_brand_id uuid, p_location_id uuid,
  p_paired_device_id uuid, p_user_id uuid
) returns timestamptz
language sql security definer set search_path = '' as $$
  select app.record_device_heartbeat(
    p_installation_id, p_brand_id, p_location_id, p_paired_device_id, p_user_id
  );
$$;
revoke all on function public.record_device_heartbeat(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_device_heartbeat(uuid, uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.create_device_stream_session(
  p_installation_id uuid, p_brand_id uuid, p_location_id uuid,
  p_viewer_id uuid, p_max_streams integer
) returns public.device_stream_sessions
language sql security definer set search_path = '' as $$
  select app.create_device_stream_session(
    p_installation_id, p_brand_id, p_location_id, p_viewer_id, p_max_streams
  );
$$;
revoke all on function public.create_device_stream_session(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.create_device_stream_session(uuid, uuid, uuid, uuid, integer)
  to service_role;

-- set_brand_kiosk_config is SECURITY INVOKER on purpose (0037 says why:
-- `brands_update` RLS is the real gate, the function boundary is not one),
-- so the wrapper mirrors that instead of quietly upgrading it to a definer
-- it never was. Its search_path is '' rather than 0037's original `public,
-- app`: 20260824072313 swept every `app`-schema function's search_path to ''
-- after the fact, so the live original -- what this wrapper must match, not
-- what 0037 first typed -- has been '' since that hardening pass. The body
-- is schema-qualified either way, so this has no behavioural effect here.
create or replace function public.set_brand_kiosk_config(
  config jsonb, expected_updated_at timestamptz default null
) returns timestamptz
language sql security invoker set search_path = '' as $$
  select app.set_brand_kiosk_config(config, expected_updated_at);
$$;
revoke execute on function public.set_brand_kiosk_config(jsonb, timestamptz)
  from anon, public;
grant execute on function public.set_brand_kiosk_config(jsonb, timestamptz)
  to authenticated;

create or replace function public.publish_catalog_draft(
  target_catalog uuid, expected_draft_version integer
) returns public.catalog_releases
language sql security definer set search_path = '' as $$
  select app.publish_catalog_draft(target_catalog, expected_draft_version);
$$;
revoke all on function public.publish_catalog_draft(uuid, integer) from public;
grant execute on function public.publish_catalog_draft(uuid, integer) to authenticated;

-- Release assertion: every wrapper must exist, its app original must still
-- exist, and its anon/authenticated reach must match that original EXACTLY.
-- A wrapper granting more than its original would turn "expose the name"
-- into "widen who can call it"; a mismatch either way means the pair has
-- drifted -- someone touched one side's grants without the other.
create or replace function app.assert_public_device_and_catalog_rpcs()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  wrappers constant text[] := array[
    'public.revoke_device_installation(uuid,uuid)',
    'public.record_device_heartbeat(uuid,uuid,uuid,uuid,uuid)',
    'public.create_device_stream_session(uuid,uuid,uuid,uuid,integer)',
    'public.set_brand_kiosk_config(jsonb,timestamptz)',
    'public.publish_catalog_draft(uuid,integer)'
  ];
  originals constant text[] := array[
    'app.revoke_device_installation(uuid,uuid)',
    'app.record_device_heartbeat(uuid,uuid,uuid,uuid,uuid)',
    'app.create_device_stream_session(uuid,uuid,uuid,uuid,integer)',
    'app.set_brand_kiosk_config(jsonb,timestamptz)',
    'app.publish_catalog_draft(uuid,integer)'
  ];
  wrapper text;
  original text;
begin
  for i in 1 .. array_length(wrappers, 1) loop
    wrapper := wrappers[i];
    original := originals[i];
    if pg_catalog.to_regprocedure(wrapper) is null then
      raise exception 'public RPC wrapper % is missing; PostgREST cannot resolve %', wrapper, original;
    end if;
    if pg_catalog.to_regprocedure(original) is null then
      raise exception 'the app original % that % delegates to is missing', original, wrapper;
    end if;
    if pg_catalog.has_function_privilege('anon', wrapper, 'execute')
       is distinct from pg_catalog.has_function_privilege('anon', original, 'execute') then
      raise exception 'anon reach on % does not match its original %', wrapper, original;
    end if;
    if pg_catalog.has_function_privilege('authenticated', wrapper, 'execute')
       is distinct from pg_catalog.has_function_privilege('authenticated', original, 'execute') then
      raise exception 'authenticated reach on % does not match its original %', wrapper, original;
    end if;
  end loop;
end $$;
revoke all on function app.assert_public_device_and_catalog_rpcs()
  from public, anon, authenticated;
grant execute on function app.assert_public_device_and_catalog_rpcs() to service_role;

select app.register_release(
  '20260912030000',
  'expose the five app-schema RPCs the apps already call by name in public, so PostgREST can resolve them',
  'app.assert_public_device_and_catalog_rpcs()'::regprocedure
);
