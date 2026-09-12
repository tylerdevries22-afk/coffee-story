-- A generic, standalone gate for foreign-key index coverage -- plus the one
-- real gap this investigation actually found.
--
-- The brief for this migration named six FK constraints as confirmed
-- uncovered, three on the `locations` cascade-delete path
-- (`public.delete_location_if_allowed`, 20260911140000): device_installations,
-- operation_schedules and site_module_overrides's `(location_id, brand_id)`
-- keys, plus one FK each on knowledge_acknowledgements and
-- operation_escalation_rules. Measured directly against this build, none of
-- them are actually uncovered, and the reason is already on record in this
-- repository: 20260830020000's own comment documents "six constraints
-- Supabase's advisor reports as unindexed" that are covered anyway --
-- `operation_staff_devices (brand_user_id, brand_id)` served by
-- `(brand_id, brand_user_id, last_action_id)` is the example it names -- "and
-- five others likewise", and it deliberately chose "the set test, not the
-- advisor's stricter ordered one, so it does not demand redundant indexes."
--
-- Re-deriving that set today (pg_constraint/pg_index against a full local
-- chain apply, cross-checked with EXPLAIN) finds the *same shape* of false
-- positive, just a larger instance of the same six: nine FKs today --
-- including all five named in this migration's brief, plus
-- operation_staff_devices itself, operation_action_receipts, an
-- operation_operator_notifications key and an operation_task_templates key --
-- whose columns are covered by a composite index that lists them in the
-- opposite order from the constraint. Postgres does not care: an index scan
-- matches equality predicates to index columns by identity, not by the order
-- they were declared or written, and `EXPLAIN` on this build confirms every
-- one of the nine gets an Index Only Scan with both FK columns as Index Cond
-- (e.g. `device_installations_wall_idx (brand_id, location_id, ...)` serves
-- `device_installations_location_id_brand_id_fkey (location_id, brand_id)`).
-- Adding a same-columns, different-order index for any of the nine would be
-- exactly the redundant index 20260830020000 already chose not to add.
--
-- So there is no per-FK index to add here -- the six named constraints (and
-- the other three like them) are not a live gap. What *is* missing is a
-- standing check with that verdict's logic that a person can find and run on
-- its own: the only assertion that currently re-derives FK coverage lives
-- inside the frozen 26-link chain from 20260830020000, reachable only via
-- `app.platform_release_readiness_20260903005237()`, which is exactly why
-- three later incidents (20260902124238, 20260908224000, 20260911170000)
-- each patched a *specific* missing index by name instead of leaning on a
-- generic, obviously-there rule. `app.assert_foreign_keys_are_indexed()`
-- below is that rule: a standalone, top-level, directly-registered assertion
-- using the same proven-correct set test, so the next uncovered FK fails the
-- release gate by itself rather than waiting for someone to notice.
--
-- The one genuine gap found along the way: apps/operator's live calendar
-- (src/features/calendar/live.ts) filters orders by
-- `brand_id = ... and scheduled_for between ...` with no index behind it.
-- orders is tiny today, so it costs nothing to close now rather than after
-- it grows.

create index if not exists orders_brand_scheduled_for_idx
  on public.orders (brand_id, scheduled_for)
  where scheduled_for is not null;

/**
 * Every public, non-partition foreign key must be backed by an index whose
 * leading columns are that key's columns, as a set (order does not matter --
 * see the migration comment above and 20260830020000 for why). Without this,
 * a parent delete or an RI check on the child is a sequential scan, and nine
 * FKs already only look safe because someone happened to check by hand.
 *
 * Registered standalone rather than folded into the legacy chain so it is
 * something a future migration author can find, read and run directly,
 * instead of the coverage rule being an implicit side effect of calling
 * `platform_release_readiness()`.
 */
create or replace function app.assert_foreign_keys_are_indexed()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  inspected integer;
  uncovered text[];
begin
  select count(*)
    into inspected
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
   where c.contype = 'f'
     and n.nspname = 'public'
     and not t.relispartition;

  -- A query that silently matched nothing would pass by finding no work to
  -- do. This schema has ~300 public foreign keys; demanding at least 40
  -- means a broken catalog join fails loudly instead of looking clean.
  if inspected < 40 then
    raise exception
      'foreign-key coverage scan only inspected % constraints (expected at least 40) -- the scan query is broken, not the schema',
      inspected;
  end if;

  select array_agg(gap.label order by gap.label)
    into uncovered
    from (
      select c.conrelid::regclass::text || '.' || c.conname as label
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class t on t.oid = c.conrelid
        join pg_catalog.pg_namespace n on n.oid = t.relnamespace
       where c.contype = 'f'
         and n.nspname = 'public'
         and not t.relispartition
         and not exists (
           select 1
             from pg_catalog.pg_index i
            where i.indrelid = c.conrelid
              and i.indisvalid
              and i.indnkeyatts >= array_length(c.conkey, 1)
              and (
                select array_agg(col order by col)
                  from unnest((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]) col
              ) = (
                select array_agg(col order by col)
                  from unnest(c.conkey) col
              )
         )
    ) gap;

  if uncovered is not null then
    raise exception
      'foreign key(s) with no covering index (leading columns, any order): %',
      array_to_string(uncovered, ', ');
  end if;
end
$$;

revoke all on function app.assert_foreign_keys_are_indexed()
  from public, anon, authenticated;
grant execute on function app.assert_foreign_keys_are_indexed()
  to service_role;

select app.register_release(
  '20260912080000',
  'standalone foreign-key index coverage gate; orders(brand_id, scheduled_for) for the operator calendar',
  'app.assert_foreign_keys_are_indexed()'::regprocedure
);
