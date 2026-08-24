-- Pack contents must come from an authored set, not from every permanent item
-- in the menu. Stable slugs keep tenant files portable between environments;
-- the order engine still resolves them inside the one published menu and
-- applies live listing, 86, rotation, and drop-window checks at checkout.

-- PostgreSQL arrays are bags by default. Eligibility is a set in the tenant
-- contract, so reject duplicates here too; otherwise an edit made outside the
-- onboarding compiler can disagree with every client about the authored
-- choice count. This helper is data-independent and safe for CHECK use.
create or replace function app.valid_slug_set(p_values text[])
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select cardinality(p_values) = count(distinct entry.slug)
     and coalesce(bool_and(
       entry.slug is not null
       and entry.slug <> ''
       and entry.slug = btrim(entry.slug)
     ), true)
    from unnest(p_values) as entry(slug)
$$;

alter table public.menu_items
  add column pack_choice_slugs text[] not null default '{}'::text[];

-- Preserve existing packs conservatively: their referenced single is the only
-- choice we can infer without inventing a merchandising decision.
update public.menu_items pack
   set pack_choice_slugs = array[single.slug]
  from public.menu_items single
 where pack.pack_size is not null
   and cardinality(pack.pack_choice_slugs) = 0
   and single.id = pack.single_item_id
   and single.brand_id = pack.brand_id
   and single.menu_id = pack.menu_id
   and single.pack_size is null;

alter table public.menu_items
  add constraint menu_items_pack_choice_slugs_shape check (
    (pack_size is null or pack_size <= 100)
    and (pack_size is null) = (cardinality(pack_choice_slugs) = 0)
    and coalesce(array_ndims(pack_choice_slugs), 1) = 1
    and cardinality(pack_choice_slugs) <= 100
    and app.valid_slug_set(pack_choice_slugs)
  );

comment on column public.menu_items.pack_choice_slugs is
  'Explicit item slugs eligible for this pack; live availability narrows this set.';

create or replace function app.pack_choices(pack public.menu_items, at_time timestamptz default now())
returns setof public.menu_items
language sql stable as $$
  select mi.*
    from public.menu_items mi
   where pack.pack_size is not null
     and mi.menu_id = pack.menu_id
     and mi.brand_id = pack.brand_id
     and mi.slug = any(pack.pack_choice_slugs)
     and mi.is_listed
     and not mi.is_86d
     and mi.pack_size is null
     and (
       pack.choice_source = 'static'
       or mi.rotation = 'permanent'
       or exists (
         select 1 from public.drops d
          where d.item_id = mi.id
            and d.brand_id = pack.brand_id
            and app.drop_visibility(d, at_time) = 'orderable'
       )
     )
   order by mi.sort_order, mi.name
$$;
