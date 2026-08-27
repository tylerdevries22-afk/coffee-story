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
      from public.catalog_nodes node where node.catalog_id = catalog.id and node.archived_at is null
        and (node.audience = 'public' or (include_staff and node.audience = 'staff'))), '[]'::jsonb),
    'placements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', placement.id, 'parentId', placement.parent_id, 'nodeId', placement.node_id,
      'sortOrder', placement.sort_order, 'isPrimary', placement.is_primary) order by placement.sort_order)
      from public.catalog_placements placement where placement.catalog_id = catalog.id
        and exists (select 1 from public.catalog_nodes child where child.id = placement.node_id and child.archived_at is null
          and (child.audience = 'public' or (include_staff and child.audience = 'staff')))
        and (placement.parent_id is null or exists (select 1 from public.catalog_nodes parent where parent.id = placement.parent_id
          and parent.archived_at is null and (parent.audience = 'public' or (include_staff and parent.audience = 'staff'))))), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', resource.id, 'kind', resource.kind, 'slug', resource.slug, 'title', resource.title,
      'summary', resource.summary, 'imageUrl', resource.image_url,
      'audience', resource.audience, 'externalRef', resource.external_ref))
      from public.catalog_resources resource where resource.catalog_id = catalog.id and resource.archived_at is null
        and (resource.audience = 'public' or (include_staff and resource.audience = 'staff'))), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', relation.id, 'sourceId', relation.source_key, 'targetId', relation.target_key,
      'kind', relation.kind) order by relation.sort_order)
      from public.catalog_relations relation where relation.catalog_id = catalog.id
        and ((exists (select 1 from public.catalog_nodes n where n.id::text = relation.source_key and n.archived_at is null
              and (n.audience = 'public' or (include_staff and n.audience = 'staff')))
            or exists (select 1 from public.catalog_resources r where r.id::text = relation.source_key and r.archived_at is null
              and (r.audience = 'public' or (include_staff and r.audience = 'staff'))))
          and (exists (select 1 from public.catalog_nodes n where n.id::text = relation.target_key and n.archived_at is null
              and (n.audience = 'public' or (include_staff and n.audience = 'staff')))
            or exists (select 1 from public.catalog_resources r where r.id::text = relation.target_key and r.archived_at is null
              and (r.audience = 'public' or (include_staff and r.audience = 'staff')))))), '[]'::jsonb),
    'publishedAt', published_time)
  from public.catalogs catalog where catalog.id = target_catalog
$$;

revoke all on function app.catalog_manifest(uuid, integer, timestamptz, boolean) from public;

-- Existing private releases are rebuilt from current authoring state so no
-- manager/owner-only JSON survives in a staff-readable row.
update public.catalog_release_private private_release set manifest = app.catalog_manifest(
  release.catalog_id, release.version, release.published_at, true
)
from public.catalog_releases release where release.id = private_release.release_id;
