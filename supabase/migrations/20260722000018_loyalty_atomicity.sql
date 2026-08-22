-- 0018: points move relatively, and a spend cannot outrun the balance.
--
-- Every points path read the balance, decided, and wrote back an absolute
-- number. Two requests that overlap therefore both read the same balance,
-- both pass their own check, and both store the same result: one of the two
-- movements is simply lost. On the redeem path that is a double-spend --
-- fire the same redemption twice with different idempotency keys and two
-- rewards are granted for one guest's points, with the row's
-- `points_balance >= 0` check unable to notice because both writers store
-- an identical, legal value.
--
-- Both functions below move the balance in one statement, so the row lock
-- serialises concurrent callers and the arithmetic happens on whatever the
-- balance actually is at that moment.

-- Spend: refuses rather than overdrawing. Returns the new balance, or null
-- when the account cannot afford it -- the caller turns null into its own
-- "insufficient points" answer.
create or replace function app.loyalty_spend(account uuid, cost bigint)
returns bigint
language sql
security definer
set search_path = public, app
as $$
  update public.loyalty_accounts
     set points_balance = points_balance - cost,
         updated_at = now()
   where id = account
     and cost > 0
     and points_balance >= cost
  returning points_balance;
$$;

-- Adjust: earn (positive) or reverse (negative), clamped at zero so a
-- reversal can never drive an account negative.
create or replace function app.loyalty_adjust(account uuid, delta bigint)
returns bigint
language sql
security definer
set search_path = public, app
as $$
  update public.loyalty_accounts
     set points_balance = greatest(0, points_balance + delta),
         -- Lifetime is a record of what was earned; a reversal does not
         -- unearn history, so only a positive delta moves it.
         lifetime_points = lifetime_points + greatest(0, delta),
         updated_at = now()
   where id = account
  returning points_balance;
$$;

-- Service-role only: every caller is engine code holding the service key.
-- No client role may move a balance directly.
revoke all on function app.loyalty_spend(uuid, bigint) from public, anon, authenticated;
revoke all on function app.loyalty_adjust(uuid, bigint) from public, anon, authenticated;
grant execute on function app.loyalty_spend(uuid, bigint) to service_role;
grant execute on function app.loyalty_adjust(uuid, bigint) to service_role;

-- One reversal per order, whatever the delivery count. The refund webhook
-- reverses an order's earn, and Square retries deliveries: the event id is
-- deduplicated, but the reversal that follows it was not, so a retry
-- reversed the same points a second time.
create unique index if not exists loyalty_events_one_reverse_per_order
  on public.loyalty_events (order_id)
  where type = 'reverse';

-- One redemption per idempotency key. The redeem route looked for a replay
-- by selecting on the note it writes; with no constraint behind it, two
-- concurrent retries of one key both found nothing and both spent.
--
-- Only keyed notes are constrained. The note reads "<reward-slug> [<key>]"
-- when the caller sent an Idempotency-Key and a bare slug otherwise, and two
-- unkeyed redemptions of the same reward are a guest legitimately claiming
-- it twice -- so the index would refuse honest work. The route now requires
-- the key; this makes the requirement enforceable rather than advisory.
create unique index if not exists loyalty_events_one_redeem_per_key
  on public.loyalty_events (account_id, note)
  where type = 'redeem' and note like '%[%]';
