-- 0040: a shop's address is public. Its commission is not.
--
-- `locations_select` is `using (true)` -- deliberately, and correctly: a
-- brand's name, address, hours and timezone are storefront data that an
-- unauthenticated app has to read before anyone signs in. RLS is row-level,
-- so that policy exposes every COLUMN of every row to `anon`.
--
-- That was a minor disclosure while the table held only storefront fields plus
-- `square_connection_id` (an opaque FK to a table with no policies at all).
-- 0039 changed the stakes in the same breath as it added the feature: it put
-- `fee_bps`, `fee_bps_tier2` and `tier_threshold_cents` on this table. Under
-- `using (true)` that makes every franchisee's negotiated commission readable
-- by every other franchisee, by every guest, and by anyone on the internet
-- with the anon key -- which ships in the app bundle by design.
--
-- A franchise platform leaking what each franchisee pays is not a privacy
-- footnote; it is the commercial relationship.
--
-- The fix is column-level, not a new view, because the rows are genuinely
-- public and only some columns are not. Postgres grants are per-column, so
-- the storefront read keeps working untouched and the sensitive columns
-- simply cease to exist for client roles.

revoke select (fee_bps, fee_bps_tier2, tier_threshold_cents, square_connection_id)
  on public.locations from anon, authenticated;

-- 0014's `alter default privileges ... grant all on tables` cannot re-grant a
-- column-level revoke on an existing table, so this holds. A future migration
-- that runs a bare `grant select on public.locations` WOULD undo it --
-- table-level grants replace the column set -- which is why the invariant is
-- pinned by a test rather than left to this comment.
comment on column public.locations.fee_bps is
  'Per-location override of brands.fee_bps. NULL inherits the brand. '
  'NOT readable by client roles: locations_select is using(true).';
comment on column public.locations.fee_bps_tier2 is
  'Per-location override of brands.fee_bps_tier2. NULL inherits the brand. '
  'NOT readable by client roles.';
comment on column public.locations.tier_threshold_cents is
  'Per-location override of brands.tier_threshold_cents. NULL inherits the '
  'brand. NOT readable by client roles.';

-- The engine reads these as the service role, which no policy or grant here
-- constrains, so per-location billing is unaffected.
