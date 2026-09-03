-- Generalize the invariant 20260903193000 wrote down for one function.
--
-- That migration identified the rule: a security definer function that takes
-- its subject as an ARGUMENT, rather than resolving it from auth.uid(), must
-- never be reachable by a session that gets to choose the argument. It then
-- enforced the rule for exactly one function -- app.network_brand_kpis, which
-- only reads.
--
-- Eight functions in public have the same shape and write. Each takes
-- p_actor_id uuid as its first argument and authorizes through
-- app.require_platform_audit, which trusts that argument:
--
--   if not exists (
--     select 1 from public.brand_users member
--     where member.user_id = p_actor_id and member.role = 'platform_admin'
--   ) then ...
--
-- Their grants are correct today -- every one is revoked from public, anon and
-- authenticated and granted only to service_role, verified across every
-- migration that mentions them. Nothing here is exploitable, and this migration
-- changes no grant and no behaviour. What it changes is what happens next time.
--
-- The risk is a single future `grant execute ... to authenticated` on one of
-- these. That is not a hypothetical mistake: it is precisely the mistake
-- 20260903193000's comment was written to prevent, and it was written there
-- because someone proposed exactly that grant for network_brand_kpis, reasoning
-- that the function "guards itself". These eight guard themselves the same way
-- -- against an identity the caller supplies. One such grant would let any
-- authenticated user pass a known platform admin's uuid and rewrite any brand's
-- settings (set_platform_brand_settings_config) or any location's fee terms
-- (set_platform_location_fee_overrides), across every tenant on the platform.
-- The release gate would stay green, because nothing asserts this.
--
-- So the habit becomes a release-gated invariant.
--
-- public.create_platform_organization is deliberately NOT in the list. It is
-- granted to authenticated, and correctly so: it resolves its actor from
-- auth.uid() in the body rather than taking one (20260831171620:290,
-- `actor_id uuid := auth.uid();`). It is the counterexample that shows what the
-- other eight would have to become before they could be granted to a client
-- role, and listing it here would assert the opposite of what it demonstrates.
create or replace function app.assert_argument_identity_writers_are_service_only()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  guarded constant text[] := array[
    'public.manage_platform_brand_member(uuid,uuid,uuid,app.brand_role,uuid[],boolean,text,uuid)',
    'public.ensure_platform_brand_membership(uuid,uuid)',
    'public.record_platform_access(uuid,uuid,uuid,text,uuid,jsonb)',
    'public.set_platform_brand_settings_config(uuid,uuid,jsonb,uuid,timestamptz)',
    'public.set_platform_kiosk_config(uuid,uuid,jsonb,uuid,timestamptz)',
    'public.get_platform_fee_terms(uuid,uuid)',
    'public.set_platform_location_fee_overrides(uuid,uuid,uuid,uuid,integer,integer,bigint)',
    'public.import_platform_brand_menu(uuid,uuid,jsonb,uuid)'
  ];
  target text;
  client text;
begin
  foreach target in array guarded loop
    -- A missing signature is a failure, not a pass. Renaming or re-typing one
    -- of these would otherwise silently empty the check while leaving it green,
    -- which is the failure mode that makes an assertion worse than none.
    if pg_catalog.to_regprocedure(target) is null then
      raise exception 'argument-identity writer % is missing; the assertion no longer covers it', target;
    end if;
    foreach client in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(client, target, 'execute') then
        raise exception 'argument-identity writer % is reachable by %, which chooses its own p_actor_id', target, client;
      end if;
    end loop;
  end loop;

  -- The counterexample, asserted as such. If this one ever stops being
  -- reachable by a signed-in user, the platform console lost its own
  -- organization-creation path and the list above lost the thing it is
  -- contrasted against.
  if pg_catalog.to_regprocedure('public.create_platform_organization(text,text,jsonb,uuid)') is null
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.create_platform_organization(text,text,jsonb,uuid)', 'execute') then
    raise exception 'the caller-identity organization writer is not reachable by authenticated';
  end if;
end $$;

revoke all on function app.assert_argument_identity_writers_are_service_only()
  from public, anon, authenticated;
grant execute on function app.assert_argument_identity_writers_are_service_only() to service_role;

select app.register_release(
  '20260904000000',
  'the eight platform writers that take p_actor_id as an argument stay service-role only, and the one that resolves auth.uid() stays reachable',
  'app.assert_argument_identity_writers_are_service_only()'::regprocedure
);
