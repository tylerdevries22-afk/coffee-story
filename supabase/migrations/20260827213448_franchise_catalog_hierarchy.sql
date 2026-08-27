-- Industry-neutral catalog authoring and immutable publication. Legacy menu
-- tables remain the commerce projection so order, recipe and drop foreign
-- keys keep their identity throughout the rollout.

alter table public.menu_categories
  add column if not exists parent_id uuid references public.menu_categories (id) on delete restrict,
  add column if not exists slug text,
  add column if not exists image_url text,
  add column if not exists audience text not null default 'public'
    check (audience in ('public', 'staff', 'manager', 'owner')),
  add column if not exists archived_at timestamptz;

update public.menu_categories
set slug = coalesce(nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''), concat('folder-', left(id::text, 8)))
where slug is null;

alter table public.menu_categories alter column slug set not null;
alter table public.menu_categories add constraint menu_categories_catalog_identity_key
  unique (id, menu_id, brand_id);
alter table public.menu_categories add constraint menu_categories_parent_tenant_fkey
  foreign key (parent_id, menu_id, brand_id)
  references public.menu_categories (id, menu_id, brand_id) on delete restrict;
create unique index menu_categories_sibling_slug_idx
  on public.menu_categories (menu_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

alter table public.menu_items
  add column if not exists catalog_audience text not null default 'public'
    check (catalog_audience in ('public', 'staff', 'manager', 'owner'));
alter table public.menus add constraint menus_catalog_identity_key unique (id, brand_id);
alter table public.menu_items add constraint menu_items_catalog_identity_key unique (id, menu_id, brand_id);

alter table public.content_media_versions
  drop constraint if exists content_media_versions_entity_type_check;
alter table public.content_media_versions
  add constraint content_media_versions_entity_type_check check (
    entity_type in ('menu_item', 'catalog_folder', 'catalog_resource', 'training_module', 'training_lesson')
  );
alter table public.content_media_versions
  drop constraint if exists content_media_versions_check1;
alter table public.content_media_versions
  add constraint content_media_versions_family_entity_check check (
    (family = 'menu' and entity_type in ('menu_item', 'catalog_folder', 'catalog_resource'))
    or (family = 'training' and entity_type in ('training_module', 'training_lesson'))
  );

create or replace function app.capture_catalog_folder_thumbnail()
returns trigger language plpgsql security definer set search_path = '' as $$
declare editor uuid;
begin
  if new.image_url is null or new.image_url !~ '^https://'
    or (tg_op = 'UPDATE' and new.image_url is not distinct from old.image_url) then return new; end if;
  select member.id into editor from public.brand_users member
    where member.brand_id = new.brand_id and member.user_id = (select auth.uid()) limit 1;
  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, public_url, created_by,
    storage_bucket, object_path
  ) values (
    new.brand_id, 'menu', 'catalog_folder', new.id::text, 'thumbnail', new.image_url, editor,
    case when position('/storage/v1/object/public/menu-images/' in new.image_url) > 0 then 'menu-images' end,
    case when position('/storage/v1/object/public/menu-images/' in new.image_url) > 0
      then split_part(new.image_url, '/storage/v1/object/public/menu-images/', 2) end
  ) on conflict do nothing;
  return new;
end $$;

revoke all on function app.capture_catalog_folder_thumbnail() from public;
create trigger menu_categories_capture_thumbnail after insert or update of image_url on public.menu_categories
  for each row execute function app.capture_catalog_folder_thumbnail();

create table public.catalog_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null check (version > 0),
  industry text not null,
  locale text not null default 'en-US',
  vocabulary jsonb not null default '{}'::jsonb check (jsonb_typeof(vocabulary) = 'object'),
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default now(),
  unique (template_key, version)
);

create table public.catalogs (
  id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  template_id uuid references public.catalog_templates (id) on delete set null,
  name text not null default 'Catalog',
  vocabulary jsonb not null default '{"catalog":"Catalog","folder":"Folder","offering":"Offering","material":"Material","procedure":"Procedure"}'::jsonb
    check (jsonb_typeof(vocabulary) = 'object'),
  draft_version integer not null default 1 check (draft_version > 0),
  updated_at timestamptz not null default now(),
  unique (brand_id),
  unique (id, brand_id),
  foreign key (id, brand_id) references public.menus (id, brand_id) on delete cascade
);

create table public.catalog_nodes (
  id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  kind text not null check (kind in ('folder', 'offering')),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(title) between 1 and 120),
  description text not null default '',
  image_url text,
  audience text not null default 'public' check (audience in ('public', 'staff', 'manager', 'owner')),
  commerce_item_id uuid,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (commerce_item_id),
  unique (id, catalog_id, brand_id),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade,
  foreign key (commerce_item_id, catalog_id, brand_id)
    references public.menu_items (id, menu_id, brand_id) on delete restrict,
  check ((kind = 'offering') = (commerce_item_id is not null))
);

create table public.catalog_placements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  parent_id uuid,
  node_id uuid not null,
  sort_order integer not null default 0,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (catalog_id, parent_id, node_id),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade,
  foreign key (parent_id, catalog_id, brand_id) references public.catalog_nodes (id, catalog_id, brand_id) on delete restrict,
  foreign key (node_id, catalog_id, brand_id) references public.catalog_nodes (id, catalog_id, brand_id) on delete restrict,
  check (parent_id is distinct from node_id)
);

create unique index catalog_placements_one_primary_idx
  on public.catalog_placements (catalog_id, node_id) where is_primary;
create index catalog_placements_parent_idx
  on public.catalog_placements (catalog_id, parent_id, sort_order);

create table public.catalog_resources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  kind text not null check (kind in ('material', 'specification', 'procedure', 'recipe', 'knowledge', 'skill', 'training_module', 'training_lesson')),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(title) between 1 and 160),
  summary text not null default '',
  audience text not null default 'staff' check (audience in ('public', 'staff', 'manager', 'owner')),
  external_ref text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (catalog_id, kind, slug),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade
);

create table public.catalog_relations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  source_key text not null,
  target_key text not null,
  kind text not null check (kind in ('requires', 'follows', 'teaches', 'develops', 'covers', 'prerequisite', 'related', 'substitute')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (catalog_id, source_key, target_key, kind),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade,
  check (source_key <> target_key)
);

create table public.catalog_releases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'published', 'retired')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (catalog_id, version),
  unique (id, brand_id),
  unique (id, catalog_id, brand_id),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade,
  foreign key (created_by, brand_id) references public.brand_users (id, brand_id) on delete set null (created_by)
);

create unique index catalog_releases_one_published_idx
  on public.catalog_releases (catalog_id) where status = 'published';
create index catalog_releases_brand_status_idx
  on public.catalog_releases (brand_id, status, version desc);

create table public.catalog_release_private (
  release_id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  foreign key (release_id, brand_id) references public.catalog_releases (id, brand_id) on delete cascade
);

create table public.catalog_publications (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  release_id uuid not null,
  version integer not null check (version > 0),
  published_at timestamptz not null default now(),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade,
  foreign key (release_id, catalog_id, brand_id) references public.catalog_releases (id, catalog_id, brand_id) on delete restrict
);

create table public.catalog_audit_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  catalog_id uuid not null,
  actor_id uuid,
  action text not null,
  release_id uuid references public.catalog_releases (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (catalog_id, brand_id) references public.catalogs (id, brand_id) on delete cascade
);

create index catalog_nodes_brand_idx on public.catalog_nodes (brand_id, catalog_id, kind);
create index catalog_resources_brand_idx on public.catalog_resources (brand_id, catalog_id, kind);
create index catalog_relations_brand_idx on public.catalog_relations (brand_id, catalog_id);

alter table public.catalog_templates enable row level security;
alter table public.catalogs enable row level security;
alter table public.catalog_nodes enable row level security;
alter table public.catalog_placements enable row level security;
alter table public.catalog_resources enable row level security;
alter table public.catalog_relations enable row level security;
alter table public.catalog_releases enable row level security;
alter table public.catalog_release_private enable row level security;
alter table public.catalog_publications enable row level security;
alter table public.catalog_audit_events enable row level security;

create policy catalog_templates_read on public.catalog_templates for select to authenticated
  using (true);
create policy catalog_templates_admin on public.catalog_templates for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy catalogs_owner on public.catalogs for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy catalog_nodes_owner on public.catalog_nodes for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy catalog_placements_owner on public.catalog_placements for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy catalog_resources_owner on public.catalog_resources for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy catalog_relations_owner on public.catalog_relations for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy catalog_releases_read on public.catalog_releases for select to public
  using (status = 'published' or app.is_brand_owner(brand_id));
create policy catalog_release_private_staff on public.catalog_release_private for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy catalog_publications_read on public.catalog_publications for select to public using (true);
create policy catalog_audit_owner_read on public.catalog_audit_events for select to authenticated
  using (app.is_brand_owner(brand_id));

revoke all on public.catalog_templates, public.catalogs, public.catalog_nodes,
  public.catalog_placements, public.catalog_resources, public.catalog_relations,
  public.catalog_releases, public.catalog_release_private, public.catalog_publications, public.catalog_audit_events
  from anon, authenticated;
grant select on public.catalog_releases, public.catalog_publications to anon;
grant select on public.catalog_templates, public.catalogs, public.catalog_nodes,
  public.catalog_placements, public.catalog_resources, public.catalog_relations,
  public.catalog_releases, public.catalog_release_private, public.catalog_publications, public.catalog_audit_events to authenticated;
grant insert, update on public.catalogs, public.catalog_nodes, public.catalog_placements,
  public.catalog_resources, public.catalog_relations to authenticated;

insert into public.catalogs (id, brand_id, name)
select id, brand_id, regexp_replace(name, 'Menu', 'Catalog', 'gi') from public.menus
on conflict (id) do nothing;

insert into public.catalog_nodes (id, brand_id, catalog_id, kind, slug, title, description, image_url)
select category.id, category.brand_id, category.menu_id, 'folder',
  category.slug, category.title, category.tagline, category.image_url
from public.menu_categories category
on conflict (id) do nothing;

insert into public.catalog_nodes (id, brand_id, catalog_id, kind, slug, title, description, image_url, audience, commerce_item_id)
select item.id, item.brand_id, item.menu_id, 'offering', item.slug, item.name,
  item.description, item.image_url, item.catalog_audience, item.id
from public.menu_items item
on conflict (id) do nothing;

insert into public.catalog_placements (brand_id, catalog_id, parent_id, node_id, sort_order, is_primary)
select category.brand_id, category.menu_id, category.parent_id, category.id, category.sort_order, true
from public.menu_categories category on conflict do nothing;

insert into public.catalog_placements (brand_id, catalog_id, parent_id, node_id, sort_order, is_primary)
select item.brand_id, item.menu_id, item.category_id, item.id, item.sort_order, true
from public.menu_items item on conflict do nothing;

insert into public.catalog_resources (brand_id, catalog_id, kind, slug, title, summary, external_ref)
select recipe.brand_id, item.menu_id, 'recipe', concat(item.slug, '-v', recipe.version),
  concat(item.name, ' recipe v', recipe.version), recipe.notes, recipe.id::text
from public.recipes recipe join public.menu_items item on item.id = recipe.menu_item_id
on conflict do nothing;

create or replace function app.sync_catalog_category()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.catalogs (id, brand_id, name)
  select menu.id, menu.brand_id, regexp_replace(menu.name, 'Menu', 'Catalog', 'gi')
  from public.menus menu where menu.id = new.menu_id on conflict (id) do nothing;
  insert into public.catalog_nodes (
    id, brand_id, catalog_id, kind, slug, title, description, image_url, audience, archived_at
  ) values (
    new.id, new.brand_id, new.menu_id, 'folder', new.slug, new.title, new.tagline,
    new.image_url, new.audience, new.archived_at
  ) on conflict (id) do update set slug = excluded.slug, title = excluded.title,
    description = excluded.description, image_url = excluded.image_url,
    audience = excluded.audience, archived_at = excluded.archived_at, updated_at = now();
  delete from public.catalog_placements where catalog_id = new.menu_id and node_id = new.id
    and is_primary;
  insert into public.catalog_placements (brand_id, catalog_id, parent_id, node_id, sort_order, is_primary)
  values (new.brand_id, new.menu_id, new.parent_id, new.id, new.sort_order, true);
  update public.catalogs set draft_version = draft_version + 1, updated_at = now() where id = new.menu_id;
  return new;
end $$;

create or replace function app.sync_catalog_offering()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.catalog_nodes (
    id, brand_id, catalog_id, kind, slug, title, description, image_url, audience, commerce_item_id
  ) values (
    new.id, new.brand_id, new.menu_id, 'offering', new.slug, new.name, new.description,
    new.image_url, new.catalog_audience, new.id
  ) on conflict (id) do update set slug = excluded.slug, title = excluded.title,
    description = excluded.description, image_url = excluded.image_url,
    audience = excluded.audience, updated_at = now();
  delete from public.catalog_placements where catalog_id = new.menu_id and node_id = new.id
    and is_primary;
  insert into public.catalog_placements (brand_id, catalog_id, parent_id, node_id, sort_order, is_primary)
  values (new.brand_id, new.menu_id, new.category_id, new.id, new.sort_order, true);
  update public.catalogs set draft_version = draft_version + 1, updated_at = now() where id = new.menu_id;
  return new;
end $$;

revoke all on function app.sync_catalog_category() from public;
revoke all on function app.sync_catalog_offering() from public;
create trigger menu_categories_sync_catalog after insert or update on public.menu_categories
  for each row execute function app.sync_catalog_category();
create trigger menu_items_sync_catalog after insert or update of slug, name, description, image_url, catalog_audience, category_id, sort_order
  on public.menu_items for each row execute function app.sync_catalog_offering();

create or replace function app.catalog_manifest(target_catalog uuid, target_version integer, published_time timestamptz, include_staff boolean)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'schemaVersion', 1, 'catalogId', catalog.id, 'brandId', catalog.brand_id,
    'version', target_version, 'vocabulary', catalog.vocabulary,
    'nodes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', node.id, 'kind', node.kind, 'slug', node.slug, 'title', node.title,
      'description', node.description, 'imageUrl', node.image_url,
      'audience', node.audience, 'archived', node.archived_at is not null,
      'commerceItemId', node.commerce_item_id,
      'commerce', case when node.kind = 'offering' then (
        select jsonb_build_object(
          'basePriceCents', item.base_price_cents, 'sizes', item.sizes,
          'optionGroups', item.modifiers, 'availability', item.availability,
          'isListed', item.is_listed)
        from public.menu_items item where item.id = node.commerce_item_id
      ) end) order by node.title)
      from public.catalog_nodes node where node.catalog_id = catalog.id
        and (include_staff or node.audience = 'public')), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', placement.id, 'parentId', placement.parent_id, 'nodeId', placement.node_id,
      'sortOrder', placement.sort_order, 'isPrimary', placement.is_primary) order by placement.sort_order)
      from public.catalog_placements placement where placement.catalog_id = catalog.id
        and exists (select 1 from public.catalog_nodes child where child.id = placement.node_id and (include_staff or child.audience = 'public'))
        and (placement.parent_id is null or exists (select 1 from public.catalog_nodes parent where parent.id = placement.parent_id and (include_staff or parent.audience = 'public')))), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', resource.id, 'kind', resource.kind, 'slug', resource.slug, 'title', resource.title,
      'summary', resource.summary, 'audience', resource.audience, 'externalRef', resource.external_ref))
      from public.catalog_resources resource where resource.catalog_id = catalog.id and resource.archived_at is null
        and (include_staff or resource.audience = 'public')), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', relation.id, 'sourceId', relation.source_key, 'targetId', relation.target_key,
      'kind', relation.kind) order by relation.sort_order)
      from public.catalog_relations relation where relation.catalog_id = catalog.id
        and (include_staff or (
          (exists (select 1 from public.catalog_nodes n where n.id::text = relation.source_key and n.audience = 'public')
            or exists (select 1 from public.catalog_resources r where r.id::text = relation.source_key and r.audience = 'public'))
          and
          (exists (select 1 from public.catalog_nodes n where n.id::text = relation.target_key and n.audience = 'public')
            or exists (select 1 from public.catalog_resources r where r.id::text = relation.target_key and r.audience = 'public'))
        ))), '[]'::jsonb),
    'publishedAt', published_time)
  from public.catalogs catalog where catalog.id = target_catalog
$$;

revoke all on function app.catalog_manifest(uuid, integer, timestamptz, boolean) from public;

create or replace function app.publish_catalog_draft(target_catalog uuid, expected_draft_version integer)
returns public.catalog_releases
language plpgsql security definer set search_path = '' as $$
declare
  catalog public.catalogs;
  release public.catalog_releases;
  editor uuid;
  next_version integer;
  published_time timestamptz := now();
begin
  select * into catalog from public.catalogs where id = target_catalog for update;
  if catalog.id is null or not app.is_brand_owner(catalog.brand_id) then raise exception 'catalog_access_denied'; end if;
  if catalog.draft_version <> expected_draft_version then raise exception 'catalog_version_conflict'; end if;
  if exists (select 1 from public.catalog_nodes node where node.catalog_id = target_catalog and not exists (
    select 1 from public.catalog_placements placement where placement.catalog_id = target_catalog
      and placement.node_id = node.id and placement.is_primary)) then raise exception 'catalog_missing_primary_placement'; end if;
  if exists (select 1 from public.catalog_placements placement
    join public.catalog_nodes parent on parent.id = placement.parent_id
    where placement.catalog_id = target_catalog and parent.kind <> 'folder') then raise exception 'catalog_parent_not_folder'; end if;
  if exists (select 1 from public.catalog_placements left_placement
    join public.catalog_placements right_placement
      on right_placement.catalog_id = left_placement.catalog_id
      and right_placement.parent_id is not distinct from left_placement.parent_id
      and right_placement.id > left_placement.id
    join public.catalog_nodes left_node on left_node.id = left_placement.node_id
    join public.catalog_nodes right_node on right_node.id = right_placement.node_id
    where left_placement.catalog_id = target_catalog and left_node.slug = right_node.slug)
    then raise exception 'catalog_duplicate_sibling_slug'; end if;
  if exists (select 1 from public.catalog_placements placement
    join public.catalog_nodes child on child.id = placement.node_id
    join public.catalog_nodes parent on parent.id = placement.parent_id
    where placement.catalog_id = target_catalog and child.audience = 'public' and parent.audience <> 'public')
    then raise exception 'catalog_public_node_under_private_parent'; end if;
  if exists (select 1 from public.catalog_relations relation where relation.catalog_id = target_catalog and (
    not exists (select 1 from public.catalog_nodes node where node.catalog_id = target_catalog and node.id::text = relation.source_key)
      and not exists (select 1 from public.catalog_resources resource where resource.catalog_id = target_catalog and resource.id::text = relation.source_key)
    or not exists (select 1 from public.catalog_nodes node where node.catalog_id = target_catalog and node.id::text = relation.target_key)
      and not exists (select 1 from public.catalog_resources resource where resource.catalog_id = target_catalog and resource.id::text = relation.target_key)
  )) then raise exception 'catalog_invalid_relation'; end if;
  with recursive paths as (
    select placement.node_id, placement.parent_id, 1 as depth, array[placement.node_id] as visited
    from public.catalog_placements placement where placement.catalog_id = target_catalog and placement.is_primary and placement.parent_id is null
    union all
    select placement.node_id, placement.parent_id, paths.depth + 1, paths.visited || placement.node_id
    from paths join public.catalog_placements placement on placement.parent_id = paths.node_id
      and placement.catalog_id = target_catalog and placement.is_primary
    where not placement.node_id = any(paths.visited)
  )
  select coalesce(max(depth), 0) into next_version from paths;
  if next_version > 5 then raise exception 'catalog_depth_exceeded'; end if;
  with recursive reachable as (
    select placement.node_id from public.catalog_placements placement
    where placement.catalog_id = target_catalog and placement.is_primary and placement.parent_id is null
    union
    select placement.node_id from reachable
    join public.catalog_placements placement on placement.parent_id = reachable.node_id
      and placement.catalog_id = target_catalog and placement.is_primary
  )
  select count(*) into next_version from reachable;
  if next_version <> (select count(*) from public.catalog_nodes where catalog_id = target_catalog)
    then raise exception 'catalog_cycle_or_orphan'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.catalog_releases where catalog_id = target_catalog;
  update public.catalog_releases set status = 'retired' where catalog_id = target_catalog and status = 'published';
  select member.id into editor from public.brand_users member
    where member.brand_id = catalog.brand_id and member.user_id = (select auth.uid()) limit 1;
  insert into public.catalog_releases (brand_id, catalog_id, version, status, manifest, created_by, published_at)
  values (catalog.brand_id, target_catalog, next_version, 'published',
    app.catalog_manifest(target_catalog, next_version, published_time, false), editor, published_time)
  returning * into release;
  insert into public.catalog_release_private (release_id, brand_id, manifest)
  values (release.id, catalog.brand_id,
    app.catalog_manifest(target_catalog, next_version, published_time, true));
  insert into public.catalog_publications (brand_id, catalog_id, release_id, version, published_at)
  values (catalog.brand_id, target_catalog, release.id, release.version, published_time)
  on conflict (brand_id) do update set release_id = excluded.release_id,
    version = excluded.version, published_at = excluded.published_at;
  insert into public.catalog_audit_events (brand_id, catalog_id, actor_id, action, release_id)
  values (catalog.brand_id, target_catalog, editor, 'catalog.published', release.id);
  update public.catalogs set draft_version = draft_version + 1, updated_at = now() where id = target_catalog;
  return release;
end $$;

revoke all on function app.publish_catalog_draft(uuid, integer) from public;
grant execute on function app.publish_catalog_draft(uuid, integer) to authenticated;

-- Seed an initial immutable release equivalent to the currently published menu.
do $$
declare catalog record;
declare release_id uuid;
declare published_time timestamptz;
begin
  for catalog in select c.* from public.catalogs c join public.menus m on m.id = c.id where m.is_published loop
    published_time := now();
    insert into public.catalog_releases (brand_id, catalog_id, version, status, manifest, published_at)
    values (catalog.brand_id, catalog.id, 1, 'published', app.catalog_manifest(catalog.id, 1, published_time, false), published_time)
    returning id into release_id;
    insert into public.catalog_release_private (release_id, brand_id, manifest)
    values (release_id, catalog.brand_id, app.catalog_manifest(catalog.id, 1, published_time, true));
    insert into public.catalog_publications (brand_id, catalog_id, release_id, version, published_at)
    values (catalog.brand_id, catalog.id, release_id, 1, published_time) on conflict do nothing;
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'catalog_publications') then
    alter publication supabase_realtime add table public.catalog_publications;
  end if;
end $$;

alter table public.catalog_publications replica identity full;
