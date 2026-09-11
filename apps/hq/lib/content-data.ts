import type { TrainingAnswerKey } from './training-bootstrap';

import { currentSession, hasRole } from './auth';
import {
  restoreTrainingAnswers,
  type ContentCategory,
  type ContentWorkspaceData,
} from './content-model';
import { serverEnv, serviceDb } from './api-auth';
import { serverClient } from './supabase-server';
import { resolveTenantTrainingProfile } from './training-bootstrap';
import { selectedOrganizationId } from './workspace-scope';
import { demoContentWorkspace } from './content-demo-workspace';
import { demoOrgById } from './demo-orgs';
import { DEMO_SESSION } from './demo-data';

import { asManifest, contentItems, loadOrCreateTenantMenu } from './content-data-helpers';
import type {
  BrandRow, CatalogPlacementRow, CatalogRelationRow, CatalogResourceRow, CategoryRow,
  ItemRow, MediaVersionRow, ReleaseRow, RunRow,
} from './content-data-types';

/** Loads the tenant workspace for exactly the tenant in the verified JWT. */
export async function loadContentWorkspace(options: { includeDraft?: boolean; includeAnswers?: boolean } = {}): Promise<ContentWorkspaceData> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'location_manager')) throw new Error('Content management requires manager access.');
  const client = await serverClient();
  if (!client) {
    const brandId = await selectedOrganizationId(session);
    if (brandId === DEMO_SESSION.brandId) return demoContentWorkspace();
    const org = demoOrgById(brandId);
    const profile = resolveTenantTrainingProfile(org?.name ?? 'Base App', org?.brandConfig ?? null);
    return demoContentWorkspace(profile);
  }
  const user = await client.auth.getUser();
  if (!user.data.user) throw new Error('Content management requires an active session.');
  const brandId = await selectedOrganizationId(session);
  const membership = await client.from('brand_users').select('role')
    .eq('brand_id', session.brandId).eq('user_id', user.data.user.id)
    .single<{ role: string }>();
  if (membership.error || !['brand_owner', 'platform_admin', 'location_manager'].includes(membership.data.role)) {
    throw new Error('Content management requires current tenant access.');
  }
  const env = serverEnv();
  if (!env) throw new Error('HQ content management requires server-side Supabase credentials.');
  const privileged = serviceDb(env);

  const brandResult = await client.from('brands')
    .select('id, name, brand_config')
    .eq('id', brandId)
    .single<BrandRow>();
  if (brandResult.error) throw new Error(`content brand: ${brandResult.error.message}`);
  const profile = resolveTenantTrainingProfile(brandResult.data.name, brandResult.data.brand_config);

  const menu = await loadOrCreateTenantMenu(client, brandId, brandId === session.brandId);

  const [categories, items, releases, runs, mediaVersions, catalog, publication, catalogResources, catalogRelations, catalogPlacements] = await Promise.all([
    client.from('menu_categories').select('id, title, tagline, slug, parent_id, image_url, audience, archived_at, sort_order')
      .eq('menu_id', menu.id).order('sort_order').returns<CategoryRow[]>(),
    client.from('menu_items')
      .select('id, name, slug, description, category_id, base_price_cents, sizes, modifiers, image_url, catalog_audience, is_listed, is_86d, sort_order, updated_at')
      .eq('menu_id', menu.id).order('sort_order').returns<ItemRow[]>(),
    client.from('training_releases').select('id, version, status, manifest, updated_at')
      .eq('brand_id', brandId).in('status', ['draft', 'published'])
      .order('created_at', { ascending: false }).returns<ReleaseRow[]>(),
    client.from('training_bootstrap_runs').select('id, status, stage, progress, created_at')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(1).returns<RunRow[]>(),
    client.from('content_media_versions').select('id, entity_type, entity_key, slot, public_url, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }).limit(500).returns<MediaVersionRow[]>(),
    client.from('catalogs').select('draft_version').eq('id', menu.id).maybeSingle<{ draft_version: number }>(),
    client.from('catalog_publications').select('version').eq('brand_id', brandId).maybeSingle<{ version: number }>(),
    client.from('catalog_resources').select('id, kind, slug, title, summary, audience, external_ref, image_url')
      .eq('brand_id', brandId).is('archived_at', null).order('kind').order('title').returns<CatalogResourceRow[]>(),
    client.from('catalog_relations').select('id, source_key, target_key, kind')
      .eq('brand_id', brandId).order('sort_order').returns<CatalogRelationRow[]>(),
    client.from('catalog_placements').select('id, node_id, parent_id, sort_order, is_primary')
      .eq('brand_id', brandId).order('sort_order').returns<CatalogPlacementRow[]>(),
  ]);
  if (categories.error) throw new Error(`content categories: ${categories.error.message}`);
  if (items.error) throw new Error(`content items: ${items.error.message}`);
  if (releases.error) throw new Error(`content training: ${releases.error.message}`);
  if (runs.error) throw new Error(`content automation: ${runs.error.message}`);
  if (mediaVersions.error) throw new Error(`content media history: ${mediaVersions.error.message}`);
  if (catalog.error) throw new Error(`content catalog: ${catalog.error.message}`);
  if (publication.error) throw new Error(`content publication: ${publication.error.message}`);
  if (catalogResources.error) throw new Error(`content catalog resources: ${catalogResources.error.message}`);
  if (catalogRelations.error) throw new Error(`content catalog relations: ${catalogRelations.error.message}`);
  if (catalogPlacements.error) throw new Error(`content catalog placements: ${catalogPlacements.error.message}`);

  const selected = (options.includeDraft !== false ? releases.data?.find((release) => release.status === 'draft') : undefined)
    ?? releases.data?.find((release) => release.status === 'published');
  let manifest = asManifest(selected?.manifest, profile);
  if (selected && options.includeAnswers !== false) {
    const privateRelease = await privileged.from('training_releases')
      .select('answer_key').eq('id', selected.id).eq('brand_id', brandId)
      .single<{ answer_key: unknown }>();
    if (privateRelease.error) throw new Error(`content answer key: ${privateRelease.error.message}`);
    manifest = restoreTrainingAnswers(manifest, privateRelease.data.answer_key as TrainingAnswerKey);
  }

  const categoryRows: ContentCategory[] = (categories.data ?? []).map((category) => ({
    id: category.id, title: category.title, tagline: category.tagline, slug: category.slug,
    parentId: category.parent_id, imageUrl: category.image_url, audience: category.audience,
    archived: category.archived_at !== null, sortOrder: category.sort_order,
    mediaVersions: (mediaVersions.data ?? []).filter((version) => version.entity_type === 'catalog_folder' && version.entity_key === category.id && version.slot === 'thumbnail')
      .map((version) => ({ id: version.id, url: version.public_url, createdAt: version.created_at })),
  }));
  const latestRun = runs.data?.[0];
  return {
    menu: {
      id: menu.id,
      name: menu.name,
      isPublished: menu.is_published,
      draftVersion: catalog.data?.draft_version ?? 1,
      publishedVersion: publication.data?.version ?? null,
      updatedAt: menu.updated_at,
    },
    categories: categoryRows,
    items: contentItems(
      items.data ?? [],
      (mediaVersions.data ?? []).filter((version) => version.entity_type === 'menu_item' && version.slot === 'thumbnail'),
    ),
    catalogResources: (catalogResources.data ?? []).map((resource) => ({
      id: resource.id, kind: resource.kind, slug: resource.slug, title: resource.title,
      summary: resource.summary, audience: resource.audience, externalRef: resource.external_ref,
      imageUrl: resource.image_url,
      mediaVersions: (mediaVersions.data ?? []).filter((version) => version.entity_type === 'catalog_resource' && version.entity_key === resource.id && version.slot === 'thumbnail')
        .map((version) => ({ id: version.id, url: version.public_url, createdAt: version.created_at })),
    })),
    catalogRelations: (catalogRelations.data ?? []).map((relation) => ({
      id: relation.id, sourceId: relation.source_key, targetId: relation.target_key, kind: relation.kind,
    })),
    catalogPlacements: (catalogPlacements.data ?? []).map((placement) => ({
      id: placement.id, nodeId: placement.node_id, parentId: placement.parent_id,
      sortOrder: placement.sort_order, isPrimary: placement.is_primary,
    })),
    trainingMediaVersions: (mediaVersions.data ?? [])
      .filter((version) => version.entity_type !== 'menu_item')
      .map((version) => ({ id: version.id, url: version.public_url, createdAt: version.created_at, entityKey: version.entity_key, slot: version.slot })),
    training: selected
      ? { id: selected.id, version: selected.version, status: selected.status, manifest, updatedAt: selected.updated_at }
      : { id: null, version: 0, status: 'empty', manifest, updatedAt: null },
    trainingProfile: profile,
    automationRun: latestRun
      ? { id: latestRun.id, status: latestRun.status, stage: latestRun.stage, progress: latestRun.progress, createdAt: latestRun.created_at }
      : null,
  };
}
