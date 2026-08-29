-- A foreign key that can cross a tenant boundary is not enforcing tenancy.
--
-- app.prep_batch_clears_86 is SECURITY DEFINER and walks two ids it is handed:
--
--   update public.menu_items mi set is_86d = false
--   from public.recipes r
--   where r.id = new.recipe_id and mi.id = r.menu_item_id;
--
-- Neither hop checks the brand. prep_batches_insert admits the row on
-- app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id) --
-- both of which describe the writer's relationship to the row being written,
-- not to the recipe it names -- and prep_batches_recipe_id_fkey referenced
-- recipes(id) alone. So staff at brand A who hold a brand B recipe id could
-- insert a prep batch against it and clear brand B's 86 flag, putting a
-- sold-out item back on sale in a shop they have no relationship with. RLS
-- keeps that id out of sight, which makes the attack impractical, but it
-- leaves the boundary resting on a UUID being hard to guess rather than on
-- the database refusing the write.
--
-- order_events_insert already does this correctly: its WITH CHECK re-reads the
-- parent and asserts target.brand_id = order_events.brand_id. The pattern is
-- established in this schema; these two edges were missed.
--
-- Enforced as a composite foreign key rather than another policy predicate.
-- A policy constrains one writer, and this trigger runs as definer on behalf
-- of every writer, service role included. A constraint holds for all of them,
-- costs an index lookup that the single-column key was already doing, and
-- cannot be forgotten by the next policy written against these tables.

-- The (id, brand_id) pairs have to be referenceable. id is already unique on
-- its own, so these add no new restriction on the data -- only a target.
alter table public.recipes
  add constraint recipes_id_brand_id_key unique (id, brand_id);
alter table public.menu_items
  add constraint menu_items_id_brand_id_key unique (id, brand_id);

-- ON DELETE behaviour is carried over unchanged from the single-column keys:
-- restrict a recipe that batches were made against, cascade a retired item's
-- recipes.
alter table public.prep_batches
  drop constraint prep_batches_recipe_id_fkey,
  add constraint prep_batches_recipe_id_fkey
    foreign key (recipe_id, brand_id) references public.recipes (id, brand_id)
    on delete restrict;

alter table public.recipes
  drop constraint recipes_menu_item_id_fkey,
  add constraint recipes_menu_item_id_fkey
    foreign key (menu_item_id, brand_id) references public.menu_items (id, brand_id)
    on delete cascade;

comment on constraint prep_batches_recipe_id_fkey on public.prep_batches is
  'Composite on purpose: app.prep_batch_clears_86 dereferences recipe_id as '
  'definer, so the brand agreement has to hold for every writer rather than '
  'for whichever writers a policy happens to cover.';
comment on constraint recipes_menu_item_id_fkey on public.recipes is
  'Composite on purpose: the second hop of app.prep_batch_clears_86. See '
  'prep_batches_recipe_id_fkey.';

-- ---------------------------------------------------------------------------
-- Readiness link.
--
-- verify.yml derives the expected readiness from the newest migration filename,
-- so every migration extends the chain or the release gate fails closed.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260829180000;
alter function public.platform_release_readiness_20260829180000() set schema app;
revoke all on function app.platform_release_readiness_20260829180000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260829180000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
declare tenant_scoped_edges integer;
begin
  if app.platform_release_readiness_20260829180000() <> '20260829180000' then
    raise exception 'device refresh readiness prerequisite is incomplete';
  end if;

  -- Assert the shape rather than the constraint name: a future migration may
  -- rebuild either key, and what must survive that is brand_id appearing on
  -- both sides of both references.
  select count(*) into tenant_scoped_edges
  from pg_catalog.pg_constraint c
  where c.contype = 'f'
    and c.conname in ('prep_batches_recipe_id_fkey', 'recipes_menu_item_id_fkey')
    and (select count(*) from unnest(c.conkey) attnum
         where attnum = (select a.attnum from pg_catalog.pg_attribute a
                         where a.attrelid = c.conrelid and a.attname = 'brand_id')) = 1
    and (select count(*) from unnest(c.confkey) attnum
         where attnum = (select a.attnum from pg_catalog.pg_attribute a
                         where a.attrelid = c.confrelid and a.attname = 'brand_id')) = 1;
  if tenant_scoped_edges <> 2 then
    raise exception 'the 86-clearing path does not agree on brand across both references';
  end if;

  -- The guard above is only worth having while something still dereferences
  -- those ids as definer. If that trigger is ever rewritten to check the brand
  -- itself, this assertion should be revisited rather than quietly kept.
  if pg_catalog.to_regprocedure('app.prep_batch_clears_86()') is null then
    raise exception 'the 86-clearing trigger this constraint defends is missing';
  end if;

  return '20260829190000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
