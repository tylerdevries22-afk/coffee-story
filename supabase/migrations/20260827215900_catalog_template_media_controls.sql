alter table public.catalog_resources add column if not exists image_url text;

create or replace function app.capture_catalog_resource_thumbnail()
returns trigger language plpgsql security definer set search_path = '' as $$
declare editor uuid;
begin
  if new.image_url is null or new.image_url = '' or new.image_url is not distinct from old.image_url then return new; end if;
  select brand_user.id into editor from public.brand_users brand_user
  where brand_user.brand_id = new.brand_id and brand_user.user_id = auth.uid() limit 1;
  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, storage_bucket, object_path, public_url, created_by
  ) values (
    new.brand_id, 'menu', 'catalog_resource', new.id::text, 'thumbnail', 'menu-images',
    case when position('/storage/v1/object/public/menu-images/' in new.image_url) > 0
      then split_part(new.image_url, '/storage/v1/object/public/menu-images/', 2) end,
    new.image_url, editor
  ) on conflict do nothing;
  return new;
end $$;

revoke all on function app.capture_catalog_resource_thumbnail() from public;
create trigger catalog_resources_capture_thumbnail after insert or update of image_url on public.catalog_resources
  for each row execute function app.capture_catalog_resource_thumbnail();

insert into public.content_media_versions (
  brand_id, family, entity_type, entity_key, slot, storage_bucket, object_path, public_url, created_at
)
select resource.brand_id, 'menu', 'catalog_resource', resource.id::text, 'thumbnail', 'menu-images',
  case when position('/storage/v1/object/public/menu-images/' in resource.image_url) > 0
    then split_part(resource.image_url, '/storage/v1/object/public/menu-images/', 2) end,
  resource.image_url, resource.updated_at
from public.catalog_resources resource
where resource.image_url is not null and resource.image_url <> ''
on conflict do nothing;

insert into public.catalog_templates (template_key, version, industry, locale, vocabulary, manifest)
values (
  'coffee-story', 1, 'specialty-coffee', 'en-US',
  '{"catalog":"Catalog","folder":"Category","offering":"Menu Item","material":"Ingredient","procedure":"Recipe"}'::jsonb,
  '{"schemaVersion":1,"folderLevels":{"minimum":0,"maximum":5},"resourceKinds":["material","specification","procedure","recipe","knowledge","skill","training_module","training_lesson"]}'::jsonb
)
on conflict (template_key, version) do update set
  industry = excluded.industry, locale = excluded.locale,
  vocabulary = excluded.vocabulary, manifest = excluded.manifest;

update public.catalogs catalog set
  template_id = template.id,
  vocabulary = template.vocabulary,
  updated_at = now(),
  draft_version = catalog.draft_version + 1
from public.catalog_templates template
join public.brands brand on brand.slug = 'coffee-story'
where template.template_key = 'coffee-story' and template.version = 1
  and catalog.brand_id = brand.id
  and (catalog.template_id is distinct from template.id or catalog.vocabulary is distinct from template.vocabulary);

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
        and node.archived_at is null and (include_staff or node.audience = 'public')), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', placement.id, 'parentId', placement.parent_id, 'nodeId', placement.node_id,
      'sortOrder', placement.sort_order, 'isPrimary', placement.is_primary) order by placement.sort_order)
      from public.catalog_placements placement where placement.catalog_id = catalog.id
        and exists (select 1 from public.catalog_nodes child where child.id = placement.node_id and child.archived_at is null and (include_staff or child.audience = 'public'))
        and (placement.parent_id is null or exists (select 1 from public.catalog_nodes parent where parent.id = placement.parent_id and parent.archived_at is null and (include_staff or parent.audience = 'public')))), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', resource.id, 'kind', resource.kind, 'slug', resource.slug, 'title', resource.title,
      'summary', resource.summary, 'imageUrl', resource.image_url,
      'audience', resource.audience, 'externalRef', resource.external_ref))
      from public.catalog_resources resource where resource.catalog_id = catalog.id and resource.archived_at is null
        and (include_staff or resource.audience = 'public')), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', relation.id, 'sourceId', relation.source_key, 'targetId', relation.target_key,
      'kind', relation.kind) order by relation.sort_order)
      from public.catalog_relations relation where relation.catalog_id = catalog.id
        and (include_staff or (
          (exists (select 1 from public.catalog_nodes n where n.id::text = relation.source_key and n.archived_at is null and n.audience = 'public')
            or exists (select 1 from public.catalog_resources r where r.id::text = relation.source_key and r.archived_at is null and r.audience = 'public'))
          and
          (exists (select 1 from public.catalog_nodes n where n.id::text = relation.target_key and n.archived_at is null and n.audience = 'public')
            or exists (select 1 from public.catalog_resources r where r.id::text = relation.target_key and r.archived_at is null and r.audience = 'public'))
        ))), '[]'::jsonb),
    'publishedAt', published_time)
  from public.catalogs catalog where catalog.id = target_catalog
$$;

revoke all on function app.catalog_manifest(uuid, integer, timestamptz, boolean) from public;
