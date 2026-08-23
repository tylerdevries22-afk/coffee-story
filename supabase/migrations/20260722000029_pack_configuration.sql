-- 0029: packs, and choosing what goes in one.
--
-- Found by walking a public ordering flow rather than by reading this schema:
-- in this category the sellable SKU is frequently a *container* -- a 4, 6 or
-- 12 pack -- and the rotating items are selections made inside it. The guest
-- buys a 6-pack and then allocates six units across whatever is available
-- that week.
--
-- menu_items.modifiers already expresses single/multi select with maxChoices
-- and priced choices. It cannot express the three things a pack needs:
--
--   1. an EXACT count, not a maximum. "Select 6" stays disabled at five.
--   2. a QUANTITY PER CHOICE. A valid selection is a multiset -- two of one
--      and four of another -- not a set of six distinct things.
--   3. a DYNAMIC choice source. The choices are this week's lineup, so they
--      change without anyone editing the pack.

alter table public.menu_items
  -- Null means this is not a pack; it is bought as itself.
  add column pack_size integer check (pack_size is null or pack_size > 0),
  add column choice_source text
    check (choice_source is null or choice_source in ('lineup', 'static')),
  -- The unit this pack is built from. Makes the "Save N%" badge derived
  -- rather than stored, so a price change cannot leave a stale discount
  -- claim on the shelf.
  add column single_item_id uuid references public.menu_items (id) on delete set null;

alter table public.menu_items
  add constraint menu_items_pack_needs_a_source
  check ((pack_size is null) = (choice_source is null));

create index menu_items_pack_idx on public.menu_items (menu_id)
  where pack_size is not null;

/**
 * The saving a pack offers against buying singles, in basis points.
 *
 * Derived, never stored. A pack whose single has no price, or which is priced
 * above its singles, returns 0 rather than a negative "saving" -- a shelf
 * should not advertise a loss.
 */
create or replace function app.pack_saving_bps(item public.menu_items)
returns integer
language sql stable as $$
  select case
    when item.pack_size is null or item.single_item_id is null then 0
    else greatest(0, (
      select ((single.base_price_cents * item.pack_size - item.base_price_cents) * 10000)
             / nullif(single.base_price_cents * item.pack_size, 0)
        from public.menu_items single
       where single.id = item.single_item_id
    ))
  end
$$;

/**
 * The choices a pack currently offers.
 *
 * A pack sourced from 'lineup' offers the permanent items plus whatever is
 * live right now, minus anything 86'd. That last part is what makes the prep
 * station's "batch done" reach an open configurator on a kiosk: clearing
 * is_86d puts the item back in this result, and Realtime carries the change.
 */
create or replace function app.pack_choices(pack public.menu_items, at_time timestamptz default now())
returns setof public.menu_items
language sql stable as $$
  select mi.*
    from public.menu_items mi
   where mi.menu_id = pack.menu_id
     and mi.is_listed
     and not mi.is_86d
     and mi.pack_size is null
     and (
       pack.choice_source = 'static'
       or mi.rotation = 'permanent'
       or exists (
         select 1 from public.drops d
          where d.item_id = mi.id
            and app.drop_visibility(d, at_time) = 'orderable'
       )
     )
   order by mi.sort_order, mi.name
$$;
