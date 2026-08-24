-- 0037: the console's first settings write, and the guards it needs.
--
-- Every write in HQ until now went through apps/hq/app/api/** with a
-- service-role client. The kiosk flow does not need that: `brands_update`
-- (0007) already says `app.is_brand_owner(id)`, so a brand owner editing their
-- own kiosk is a thing RLS permits. Routing it through a service-role endpoint
-- would create a fifth surface that bypasses the policy, the 0031 fee-terms
-- trigger and the 0034 view guards, and then re-implement the first of those
-- three by hand.
--
-- What that leaves is a mechanical problem: supabase-js cannot express an
-- update whose value references the column being updated. `.update({...})`
-- sends a literal. So `brand_config = brand_config || ...` is only expressible
-- through an RPC, and only atomic if it lives here.
--
-- ---------------------------------------------------------------------------
-- 1. Why the merge is not optional.
--
-- An editor that only knows about the `kiosk` key writing the WHOLE
-- brand_config drops every sibling. One of those siblings is
-- `tax.jurisdictions`, and `parseTaxJurisdictions` (packages/engine/src/tax.ts)
-- THROWS on a malformed value rather than skipping it -- deliberately, because
-- the alternative is undercharging tax. So the failure mode of a careless save
-- is not a missing tax row: it is every subsequent order on that brand
-- returning 500 until someone restores the config by hand. A read-modify-write
-- in TypeScript has the same hole under a race.

create or replace function app.set_brand_kiosk_config(
  config jsonb,
  expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
-- SECURITY INVOKER (the default, stated because 0031 §1 is a whole section
-- about a definer view nobody meant to be one). This is not a privilege
-- boundary: `brands_update` is what gates it, and it still applies.
security invoker
set search_path = public, app
as $$
declare
  target public.brands%rowtype;
  offending text;
begin
  if jsonb_typeof(config) is distinct from 'object' then
    raise exception 'kiosk config must be a JSON object';
  end if;

  -- ---------------------------------------------------------------------
  -- 2. Size, because this object is on the hot path twice.
  --
  -- brand_config is selected on EVERY order (apps/hq/app/api/orders/route.ts)
  -- and on every anonymous storefront boot through the brand_storefront view.
  -- A base64 image pasted into an attract URL would become a tax on every
  -- guest, forever, and nothing else in the system would complain.
  if pg_column_size(config) > 16384 then
    raise exception 'kiosk_config_too_large: % bytes, limit 16384', pg_column_size(config);
  end if;

  -- ---------------------------------------------------------------------
  -- 3. No secrets, because brand_storefront grants select to anon.
  --
  -- The obvious thing to put in `chrome` is a staff passcode. The schema has
  -- no field for one and this refuses any key that looks like it anyway --
  -- the rule is enforced rather than documented.
  select key into offending
  from jsonb_each_text(jsonb_strip_nulls(config)) as top(key, value)
  where key ~* '(passcode|secret|token|password|api_?key)'
  limit 1;
  if offending is not null then
    raise exception 'kiosk config may not carry secrets (key "%"): it is world-readable', offending;
  end if;

  -- ---------------------------------------------------------------------
  -- 4. Belt and braces on the merge target.
  --
  -- The merge below writes under one key and cannot reach these. If a future
  -- edit changes the target, this fails loudly instead of quietly widening.
  if config ?| array['tax', 'loyalty', 'tokens', 'copy', 'identity', 'business', 'board'] then
    raise exception 'kiosk config may only contain kiosk settings';
  end if;

  select * into target from public.brands where id = app.jwt_brand_id();
  if not found then
    raise exception 'no brand in scope';
  end if;

  -- ---------------------------------------------------------------------
  -- 5. Optimistic concurrency.
  --
  -- The single UPDATE is already safe against a writer of a DIFFERENT key --
  -- the row lock serialises and `||` preserves siblings. It is not safe
  -- against two owners editing the kiosk in two tabs: the second silently
  -- wins. `brands` has updated_at and a touch trigger (0002), so turning that
  -- into "someone else saved, reload" costs four lines, and this config
  -- reaches every lobby screen in the chain.
  if expected_updated_at is not null
     and target.updated_at is distinct from expected_updated_at then
    raise exception 'kiosk_config_stale';
  end if;

  update public.brands
     set brand_config = brand_config || jsonb_build_object('kiosk', config)
   where id = target.id
   returning updated_at into target.updated_at;

  return target.updated_at;
end $$;

-- anon has no brand and no business calling this; authenticated callers are
-- still gated by brands_update, which only a brand owner satisfies.
revoke execute on function app.set_brand_kiosk_config(jsonb, timestamptz) from anon, public;
grant execute on function app.set_brand_kiosk_config(jsonb, timestamptz) to authenticated;

comment on function app.set_brand_kiosk_config(jsonb, timestamptz) is
  'Merges the kiosk flow into brands.brand_config without touching its siblings. '
  'SEMANTIC validation lives in packages/domain/src/kiosk-flow.ts and is deliberately '
  'NOT duplicated here: two implementations of the same rules drift within a release, '
  'and the device resolver already fails safe on read. This function guards only what '
  'TypeScript cannot -- size, secrets, and the merge target.';
