-- Onboarding a new tenant could not install a single module, and the release
-- gate went red the moment it tried to exist.
--
-- `20260902220257` backfills a `module_installations` row for every brand whose
-- legacy flag was true *at migration time*, and registers a readiness assertion
-- that the two stay in step. A brand created afterwards -- which is every
-- franchise onboarded from here on -- gets `drops` (and the rest) from the
-- column defaults and `brand.json`, and no installation at all. The head then
-- raises `legacy drops flag is not fully backfilled`, so the platform is
-- unreleasable until someone hand-writes rows.
--
-- There was no supported way to write them. `app.create_module_installation`
-- exists and `service_role` may execute it, but it lives in schema `app`, and
-- PostgREST only exposes `public` -- so the Supabase client that `pnpm onboard`
-- is built on cannot reach it. Direct inserts are refused by
-- `app.reject_unguarded_module_installation_write`, correctly: that guard is
-- what makes `module_installations` the authorization root. The missing piece
-- is a front door, not a loosening.
--
-- This adds one. It is `security definer` and granted to `service_role` only,
-- so the guarded writer and its audit trail stay the single path; the wrapper
-- walks the same lifecycle a console operator would.
--
-- Estimated cost: one function created. No table read, rewritten or locked.

create or replace function public.install_brand_module(
  p_brand_id uuid,
  p_module_key text,
  p_version text default '1.0.0',
  p_config jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.module_installations%rowtype;
  installation_id uuid;
  revision integer;
begin
  select * into existing
  from public.module_installations target
  where target.brand_id = p_brand_id and target.module_key = p_module_key;

  -- Idempotent, and deliberately inert on anything already installed.
  --
  -- Onboarding is re-run routinely, and a module may legitimately be sitting in
  -- `suspended` or `error` because an operator put it there. Walking it back to
  -- active here would let a routine `pnpm onboard` silently undo a deliberate
  -- suspension, which is the one thing an authorization root must not do. So an
  -- existing row is returned untouched, whatever its state, and moving it is
  -- left to `app.set_module_installation_state` and a human.
  if found then
    return existing.id;
  end if;

  installation_id := app.create_module_installation(
    p_brand_id, p_module_key, p_version, p_config, null, gen_random_uuid()
  );

  -- `create_module_installation` lands in `draft`; `active` is two transitions
  -- away and the machine permits no shortcut. Each step is audited, so an
  -- installed module carries the same event trail as one activated by hand.
  revision := app.set_module_installation_state(
    installation_id, p_brand_id, 'validating', null, 1, null, gen_random_uuid()
  );
  revision := app.set_module_installation_state(
    installation_id, p_brand_id, 'active', null, revision, null, gen_random_uuid()
  );

  return installation_id;
end $$;

revoke all on function public.install_brand_module(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.install_brand_module(uuid, text, text, jsonb)
  to service_role;

comment on function public.install_brand_module(uuid, text, text, jsonb) is
  'Service-role front door for installing a module on a brand. Idempotent, and '
  'returns an existing installation untouched rather than reactivating it. '
  'Delegates to the guarded writer so the audit trail is never bypassed.';

select app.register_release(
  '20260904030000',
  'onboarding can install the modules a tenant''s flags imply'
);
