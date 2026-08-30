-- Re-pins search_path on the two claim helpers the previous migration replaced.
--
-- 20260824072313 swept every function in the `app` schema with
-- `alter function ... set search_path = ''`, so a helper that later becomes a
-- definer function cannot be redirected by a caller's search_path. A
-- `create or replace function` writes the whole definition, SET clauses
-- included, so replacing jwt_brand_id and jwt_location_ids in
-- 20260830000000 silently unpinned both -- caught by the database linter,
-- which reported function_search_path_mutable on exactly those two and on
-- nothing else.
--
-- Safe to pin: both reference app.jwt_claims() by schema, and everything else
-- they touch (the cast to uuid, the regex operator, jsonb_typeof,
-- jsonb_array_elements_text, array_agg, coalesce) resolves from pg_catalog,
-- which is implicit regardless of search_path. That is why the originals ran
-- under the same empty path.
--
-- `alter function` rather than another `create or replace`, so this migration
-- cannot drift from the body the one before it established.

alter function app.jwt_brand_id() set search_path = '';
alter function app.jwt_location_ids() set search_path = '';
