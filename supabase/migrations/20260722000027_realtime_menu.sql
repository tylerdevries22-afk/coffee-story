-- 0027: the menu has to reach a screen that is already running.
--
-- Central control of the lineup is the whole point of the architecture: a
-- change made once should appear on every kiosk and display at once. Realtime
-- only carried order_events, so a lineup change reached nothing that was not
-- restarted -- which on a wall-mounted tablet means nobody sees it until
-- someone power-cycles it.
--
-- 0013 documents the pitfall this repeats: a table is only ever *added* to
-- supabase_realtime, and adding one that is already a member raises, so each
-- add is guarded.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_items'
  ) then
    alter publication supabase_realtime add table public.menu_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_categories'
  ) then
    alter publication supabase_realtime add table public.menu_categories;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drops'
  ) then
    alter publication supabase_realtime add table public.drops;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prep_batches'
  ) then
    alter publication supabase_realtime add table public.prep_batches;
  end if;
end $$;

-- Realtime sends the old row on update/delete only when the table says to.
-- Without this an 86 arrives as a payload with no way to tell which item
-- changed, because the primary key lives in the old record.
alter table public.menu_items replica identity full;
alter table public.prep_batches replica identity full;
