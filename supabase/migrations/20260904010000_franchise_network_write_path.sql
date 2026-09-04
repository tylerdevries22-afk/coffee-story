-- The franchise network tables get the writers 20260902083817 promised them.
--
-- That migration's own comment (line 213) says "Writes go through the engine's
-- service role and the guarded writers, never through a direct client call".
-- The module tables got theirs -- app.create_module_installation and
-- app.set_module_installation_state, closed off further by 20260903170000 --
-- and the four franchise tables got none. franchise_networks,
-- franchise_memberships, franchise_network_brands and delegated_access_grants
-- have never been written by anything under apps/, packages/ or scripts/. The
-- only code that names them at all is three reads in
-- apps/hq/lib/network-reporting.ts.
--
-- So creating a network, enrolling a franchisee, or lending a franchisor's
-- analyst a scoped view of a brand is a person holding
-- SUPABASE_SERVICE_ROLE_KEY typing INSERT at a prompt. That path has no
-- validation beyond the table CHECKs, writes no platform_access_events row, and
-- is not idempotent -- a re-run enrols a brand twice or raises 23505 depending
-- on which table it hits. At fifty brands it is roughly a hundred and fifty
-- hand-written statements, each of which is also the audit trail's only record
-- that it happened, which is to say there is none.
--
-- The worse gap is the other direction. NOTHING has ever set revoked_at except
-- public.prune_delegated_access_grants (20260903153000), and that sweeper only
-- back-dates grants whose expires_at has already passed -- it is retention, not
-- revocation. There is no early-termination path at all. Cutting a fired
-- franchisee analyst's access today means waiting for expires_at, which the
-- table's CHECK bounds at thirty days and nothing bounds below that.
-- public.revoke_delegated_access is the answer and is the reason this migration
-- exists; the other three are the enrolment path it needs to be useful.
--
-- Shape. Every function here follows public.create_platform_organization
-- (20260831171620:284) rather than the eight service-only platform writers:
-- it is granted to `authenticated`, and it resolves the acting user from
-- auth.uid() IN THE BODY instead of taking one as an argument. That is not a
-- style preference. 20260904000000 makes it a release-gated invariant that a
-- security definer function taking its subject as an argument stays
-- unreachable by any role that gets to choose the argument, because such a
-- function is self-authorizing only while its caller is trusted to name the
-- subject honestly. These four have to be reachable by a browser session, so
-- the identity cannot be a parameter. p_grantee_user_id is the OBJECT of a
-- grant, not the identity being authorized, which is why it may be an
-- argument: no branch below tests it against anything.
--
-- Correlation ids are generated inside each function rather than accepted,
-- because the signatures are fixed by the surface that calls them. That gives
-- up the (action, correlation_id) idempotency record_platform_access relies
-- on, so idempotency is expressed in the target tables instead -- ON CONFLICT
-- DO NOTHING for an enrolment, a revoked_at null test for a revocation -- and
-- an audit row is written only when the call actually changed something. One
-- event means one enrolment or one revocation, not one click.
--
-- Locks and volume. Nothing is altered, backfilled or rewritten: this creates
-- five functions and inserts one row into app.release_assertions. No lock is
-- taken on any public table. The four tables it teaches the platform to write
-- hold one row per network, per membership, per enrolment and per live
-- delegation -- tens of rows on the largest deployment, with a thirty-day life
-- on the last of them.

-- 1. Networks --------------------------------------------------------------

-- Creating a network is a platform-operator action, like creating a tenant.
-- There is no franchisor to authorize it: a network has no owner until it has
-- a membership, and it has no membership until it exists.
--
-- The creator is enrolled as franchisor_admin in the same transaction, for the
-- same reason create_platform_organization inserts its own brand_users row.
-- franchise_networks_select is `app.is_franchise_network_member(id,
-- auth.uid())`, so without that insert the operator would create a network
-- neither they nor anyone else could read, and enroll_brand_in_network below
-- would have no network admin to admit. `franchisor_admin` rather than
-- `franchisor_analyst`: the creator has to be able to enrol brands.
create or replace function public.create_franchise_network(
  p_name text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  network_id uuid;
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  -- Restated rather than left to the table CHECKs so the caller gets one
  -- structured error instead of a constraint name, and so the bounds are
  -- visible next to the authorization that admits the write.
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or p_slug !~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception using errcode = '22023', message = 'invalid_franchise_network';
  end if;

  insert into public.franchise_networks (name, slug)
  values (btrim(p_name), p_slug)
  on conflict (slug) do nothing
  returning id into network_id;
  -- A taken slug is refused, not adopted. Returning the existing network would
  -- be idempotent and wrong: a typo would hand the caller administration of
  -- somebody else's network, and the caller has no way to tell that apart from
  -- having just created one.
  if network_id is null then
    raise exception using errcode = '23505', message = 'franchise_network_slug_taken';
  end if;

  insert into public.franchise_memberships (network_id, user_id, role)
  values (network_id, actor_id, 'franchisor_admin');

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, null, null, 'franchise_network.create',
    pg_catalog.gen_random_uuid(),
    pg_catalog.jsonb_build_object(
      'network_id', network_id, 'slug', p_slug, 'surface', 'hq')
  );
  return network_id;
end $$;

revoke all on function public.create_franchise_network(text, text)
  from public, anon;
grant execute on function public.create_franchise_network(text, text)
  to authenticated, service_role;

comment on function public.create_franchise_network(text, text) is
  'Creates a franchise network and enrols its creator as franchisor_admin. '
  'Platform administrators only; resolves the actor from auth.uid() so the '
  'caller cannot ask on another operator''s behalf.';

-- 2. Enrolment -------------------------------------------------------------

-- Two roles may enrol a brand: a platform administrator, and an admin of the
-- network the brand is joining. The schema expresses no owner column on
-- franchise_networks, so franchise_memberships.role = 'franchisor_admin' is
-- what "the network's owner" means here -- the same distinction
-- app.is_franchise_network_admin was written for in 20260902083817 and which
-- the franchise_memberships_select policy already relies on.
--
-- Deliberately NOT admitted: the enrolling brand's own owner. A franchisee
-- opting their own brand into a network would let that network's franchisor
-- read their KPIs (caller_network_brand_kpis returns every enrolled brand to
-- every member) on one party's say-so. Enrolment is the franchisor's decision
-- to make and the platform's to supervise.
--
-- Returns true when the enrolment happened and false when the brand was
-- already enrolled: a second call is a no-op rather than a 23505, and the
-- caller can still tell which of the two it got.
create or replace function public.enroll_brand_in_network(
  p_network_id uuid,
  p_brand_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  enrolled boolean := false;
begin
  if actor_id is null or not (
    exists (
      select 1 from public.brand_users member
      where member.user_id = actor_id and member.role = 'platform_admin'
    )
    or app.is_franchise_network_admin(p_network_id, actor_id)
  ) then
    raise exception using errcode = '42501', message = 'network_admin_required';
  end if;
  if not exists (
    select 1 from public.franchise_networks network where network.id = p_network_id
  ) then
    raise exception using errcode = '23503', message = 'franchise_network_not_found';
  end if;
  if not exists (select 1 from public.brands brand where brand.id = p_brand_id) then
    raise exception using errcode = '23503', message = 'franchise_brand_not_found';
  end if;

  insert into public.franchise_network_brands (network_id, brand_id, added_by)
  values (p_network_id, p_brand_id, actor_id)
  on conflict (network_id, brand_id) do nothing;
  -- FOUND after an INSERT ... ON CONFLICT DO NOTHING is false when the
  -- conflict swallowed the row, which is exactly the no-op this needs to
  -- report. The audit row follows it: a repeat call changed nothing, so it
  -- leaves nothing in the trail.
  enrolled := found;
  if enrolled then
    insert into public.platform_access_events (
      actor_id, brand_id, location_id, action, correlation_id, metadata
    ) values (
      actor_id, p_brand_id, null, 'franchise_network.brand_enroll',
      pg_catalog.gen_random_uuid(),
      pg_catalog.jsonb_build_object('network_id', p_network_id, 'surface', 'hq')
    );
  end if;
  return enrolled;
end $$;

revoke all on function public.enroll_brand_in_network(uuid, uuid)
  from public, anon;
grant execute on function public.enroll_brand_in_network(uuid, uuid)
  to authenticated, service_role;

comment on function public.enroll_brand_in_network(uuid, uuid) is
  'Enrols a brand in a franchise network, idempotently. Platform '
  'administrators and the network''s own franchisor_admins; resolves the '
  'actor from auth.uid(). Returns false when the brand was already enrolled.';

-- 3. Delegation ------------------------------------------------------------

-- A brand lends a scoped, time-boxed view of itself. The decision therefore
-- belongs to that brand's owner -- app.is_brand_owner is the same predicate
-- delegated_access_grants_select uses to decide who may read the grant history
-- -- with platform_admin admitted alongside for support.
--
-- Not admitted: a franchisor_admin of the network. The network is the
-- BENEFICIARY of a grant, and a party that can issue itself access to a
-- tenant's data has not been given delegated access, it has been given the
-- tenant. app.is_brand_owner already folds in the JWT platform_admin claim;
-- the brand_users branch is kept explicitly so a support session whose token
-- carries a tenant's brand_id still authorizes, exactly as
-- create_platform_organization's check does.
--
-- The brand must already be enrolled in the network. Without that check a
-- grant could name any (network, brand) pair, and
-- caller_network_brand_kpis joins franchise_network_brands to decide what a
-- delegate sees -- so an off-network grant would be a row that authorizes
-- nothing, readable by a grantee who has been told they have access.
create or replace function public.grant_delegated_access(
  p_network_id uuid,
  p_brand_id uuid,
  p_grantee_user_id uuid,
  p_scope text[],
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  grant_id uuid;
begin
  if actor_id is null or not (
    exists (
      select 1 from public.brand_users member
      where member.user_id = actor_id and member.role = 'platform_admin'
    )
    or app.is_brand_owner(p_brand_id)
  ) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  if p_grantee_user_id is null or p_grantee_user_id = actor_id then
    -- A grant to oneself is either a mistake or an attempt to launder a
    -- brand-owner's own access into a network-scoped one; the owner already
    -- reads their own brand.
    raise exception using errcode = '22023', message = 'invalid_delegated_grantee';
  end if;
  if p_scope is null
     or pg_catalog.cardinality(p_scope) not between 1 and 32
     or not app.valid_delegated_scope(p_scope) then
    raise exception using errcode = '22023', message = 'invalid_delegated_scope';
  end if;
  -- The thirty-day ceiling the table CHECK already carries, restated so the
  -- caller is told what it did wrong, plus the floor the CHECK cannot express:
  -- a grant that has already expired is not a grant.
  if p_expires_at is null
     or p_expires_at <= pg_catalog.now()
     or p_expires_at > pg_catalog.now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'invalid_delegated_expiry';
  end if;
  if not exists (
    select 1 from public.franchise_network_brands member_brand
    where member_brand.network_id = p_network_id
      and member_brand.brand_id = p_brand_id
  ) then
    raise exception using errcode = '23514', message = 'delegated_brand_outside_network';
  end if;

  -- The grantee is checked by the foreign key rather than by a read of
  -- auth.users: no definer in this tree reads that table, and a membership
  -- probe against it would be an account-enumeration oracle for any brand
  -- owner. The handler converts the constraint into the same structured shape
  -- every other refusal here uses.
  begin
    insert into public.delegated_access_grants (
      brand_id, network_id, grantee_user_id, scope, created_by, expires_at
    ) values (
      p_brand_id, p_network_id, p_grantee_user_id, p_scope, actor_id, p_expires_at
    ) returning id into grant_id;
  exception when foreign_key_violation then
    raise exception using errcode = '23503', message = 'delegated_grantee_not_found';
  end;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, p_brand_id, null, 'franchise_network.delegated_grant',
    pg_catalog.gen_random_uuid(),
    pg_catalog.jsonb_build_object(
      'network_id', p_network_id, 'grant_id', grant_id,
      'grantee_user_id', p_grantee_user_id, 'scope', pg_catalog.to_jsonb(p_scope),
      'expires_at', p_expires_at, 'surface', 'hq')
  );
  return grant_id;
end $$;

revoke all on function public.grant_delegated_access(uuid, uuid, uuid, text[], timestamptz)
  from public, anon;
grant execute on function public.grant_delegated_access(uuid, uuid, uuid, text[], timestamptz)
  to authenticated, service_role;

comment on function public.grant_delegated_access(uuid, uuid, uuid, text[], timestamptz) is
  'Issues a scoped, time-boxed delegated access grant over one enrolled '
  'brand. The granting brand''s owner or a platform administrator; resolves '
  'the actor from auth.uid(). Refuses a brand outside the network and any '
  'expiry outside (now, now + 30 days].';

-- 4. Revocation ------------------------------------------------------------

-- The function this migration is for. Before it, revoked_at was written by one
-- caller -- the retention sweeper, back-dating grants that had already run out
-- -- so ending a delegation early was not something the platform could do at
-- all.
--
-- Same authorization as issuing one, and for the same reason: the brand that
-- lent the access decides when it stops, and a platform administrator can act
-- when the brand cannot. The grantee is NOT admitted; a delegate declining
-- their own access is a different, harmless operation, but it is not this one,
-- and adding it would mean a fired analyst could tidy away the grant row the
-- brand owner is meant to keep (delegated_access_grants_select leaves the
-- granting brand its whole history on purpose).
--
-- revoked_at is least(now(), expires_at) rather than now(). The sweeper's
-- comment fixes the meaning of this column -- "the moment the grant actually
-- stopped authorizing, not now()" -- and the retention window is measured from
-- it. For a grant that is still live those are the same value. For one that
-- expired before anyone got round to revoking it, now() would postdate the end
-- of a grant that stopped authorizing days ago and would extend its retention
-- by exactly that much.
create or replace function public.revoke_delegated_access(p_grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target public.delegated_access_grants%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  -- Locked before the authorization check so two concurrent revocations
  -- serialize here rather than racing on the update below, and so the second
  -- one sees revoked_at already set and reports the no-op.
  select * into target from public.delegated_access_grants existing
  where existing.id = p_grant_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'delegated_grant_not_found';
  end if;
  if not (
    exists (
      select 1 from public.brand_users member
      where member.user_id = actor_id and member.role = 'platform_admin'
    )
    or app.is_brand_owner(target.brand_id)
  ) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  -- Idempotent: an already-ended grant is left exactly as the first
  -- revocation or the sweeper stamped it, and writes no second audit row.
  if target.revoked_at is not null then
    return false;
  end if;

  update public.delegated_access_grants existing
     -- LEAST is a parser construct rather than a catalog function, so it
     -- cannot be schema-qualified and needs no search_path entry to resolve.
     set revoked_at = least(pg_catalog.now(), existing.expires_at)
   where existing.id = target.id;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, target.brand_id, null, 'franchise_network.delegated_revoke',
    pg_catalog.gen_random_uuid(),
    pg_catalog.jsonb_build_object(
      'network_id', target.network_id, 'grant_id', target.id,
      'grantee_user_id', target.grantee_user_id, 'surface', 'hq')
  );
  return true;
end $$;

revoke all on function public.revoke_delegated_access(uuid)
  from public, anon;
grant execute on function public.revoke_delegated_access(uuid)
  to authenticated, service_role;

comment on function public.revoke_delegated_access(uuid) is
  'Ends a delegated access grant immediately. The granting brand''s owner or '
  'a platform administrator; resolves the actor from auth.uid(). Idempotent: '
  'revoking an already-ended grant returns false and changes nothing.';

-- Readiness ----------------------------------------------------------------

-- Three things would break this silently and none of them would fail a test
-- that only read the migration text: a writer dropped or re-signatured out
-- from under the surface that calls it, a grant to anon, and the revocation
-- path losing the `authenticated` grant that makes it reachable from a
-- browser session at all. A missing signature is a failure rather than a pass,
-- the way 20260904000000 states it: an assertion that quietly stops covering
-- anything is worse than no assertion.
create or replace function app.assert_franchise_network_write_path()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  writers constant text[] := array[
    'public.create_franchise_network(text,text)',
    'public.enroll_brand_in_network(uuid,uuid)',
    'public.grant_delegated_access(uuid,uuid,uuid,text[],timestamptz)',
    'public.revoke_delegated_access(uuid)'
  ];
  target text;
begin
  foreach target in array writers loop
    if pg_catalog.to_regprocedure(target) is null then
      raise exception 'franchise network writer % is missing; the write path no longer covers it', target;
    end if;
    if pg_catalog.has_function_privilege('anon', target, 'execute') then
      raise exception 'franchise network writer % is reachable by anon', target;
    end if;
    if not pg_catalog.has_function_privilege('authenticated', target, 'execute') then
      raise exception 'franchise network writer % is not reachable by a signed-in session', target;
    end if;
    -- The counterpart of 20260904000000's rule, stated positively. These four
    -- ARE reachable by a role that chooses its own arguments, so the identity
    -- they authorize must not be one of those arguments.
    if pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(target))
       !~ 'actor_id uuid := \(select auth\.uid\(\)\)' then
      raise exception 'franchise network writer % no longer resolves its actor from auth.uid()', target;
    end if;
    if pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(target))
       !~ 'SECURITY DEFINER' then
      raise exception 'franchise network writer % is no longer security definer', target;
    end if;
  end loop;

  -- Named on its own as well as in the loop. It is the function the release
  -- exists for: without it a fired delegate keeps access for up to thirty
  -- days, and a franchise deployment with no revocation path should not pass
  -- readiness even if the other three survive.
  if not pg_catalog.has_function_privilege(
       'authenticated', 'public.revoke_delegated_access(uuid)', 'execute') then
    raise exception 'delegated access cannot be revoked by the brand that granted it';
  end if;
end $$;

revoke all on function app.assert_franchise_network_write_path()
  from public, anon, authenticated;
grant execute on function app.assert_franchise_network_write_path() to service_role;

select app.register_release(
  '20260904010000',
  'the franchise network tables get caller-identity writers: create, enrol, grant, and the early revocation nothing could do before',
  'app.assert_franchise_network_write_path()'::regprocedure
);
