-- Claim helpers answer NULL for a malformed claim instead of raising.
--
-- app.jwt_brand_id() cast the claim straight to uuid, so a token whose
-- app_metadata.brand_id is a non-empty string that is not a UUID raised
-- 22P02 invalid_text_representation. That error is thrown from inside the
-- USING clause of every policy that calls it, so the failure is not "this
-- row is not yours" -- it is every read and write on that session dying with
-- a database error, from the guest's order list to the operator's queue.
--
-- app.jwt_location_ids() had the same cast per element, plus a second shape
-- to get wrong: jsonb_array_elements_text raises 22023 when location_ids is
-- an object or a scalar rather than an array.
--
-- Claims are minted by an auth hook, so a malformed one means a bug upstream
-- or hand-edited metadata rather than an attacker's choice, and the failure
-- was closed rather than open -- nothing leaked. It was still the wrong
-- failure. A claim that cannot be read is a claim the holder does not have,
-- which is what NULL already means to every policy here: `id = NULL` and
-- `NULL = target_brand` are both not-true, so an unreadable claim denies on
-- exactly the paths a missing one denies, and says so as a permission result
-- instead of an exception.
--
-- Guarded with a pattern rather than a plpgsql exception block so both stay
-- pure `stable` SQL and remain inlinable inside a policy.

create or replace function app.jwt_brand_id() returns uuid
language sql stable as $$
  select case
    when app.jwt_claims() ->> 'brand_id'
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (app.jwt_claims() ->> 'brand_id')::uuid
  end
$$;

-- A malformed element is dropped rather than failing the whole array: the
-- other locations in the claim are still legitimately the holder's, and
-- discarding them would lock a manager out of shops they can manage.
create or replace function app.jwt_location_ids() returns uuid[]
language sql stable as $$
  select coalesce(
    (select array_agg(value::uuid)
       from jsonb_array_elements_text(
         case when jsonb_typeof(app.jwt_claims() -> 'location_ids') = 'array'
              then app.jwt_claims() -> 'location_ids'
              else '[]'::jsonb
         end)
      where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    '{}'::uuid[]
  )
$$;
