'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import {
  slugFromLabel,
  type ContentCatalogRelation,
  type ContentCatalogResource,
} from '@/lib/content-model';

import {
  UUID,
  isFailure,
  managerContext,
  retryWrite,
  type Failure,
} from './actions-shared';

export async function addCatalogResource(
  kind: ContentCatalogResource['kind'],
  title: string,
  summary: string,
  audience: ContentCatalogResource['audience'],
): Promise<Failure | { ok: true; resource: ContentCatalogResource; persisted: boolean }> {
  const kinds: ContentCatalogResource['kind'][] = ['material', 'specification', 'procedure', 'recipe', 'knowledge', 'skill', 'training_module', 'training_lesson'];
  const audiences: ContentCatalogResource['audience'][] = ['public', 'staff', 'manager', 'owner'];
  const cleanTitle = title.trim();
  if (!kinds.includes(kind) || !audiences.includes(audience) || cleanTitle.length < 2 || cleanTitle.length > 160 || summary.length > 1200) {
    return { ok: false, error: 'The resource details are invalid.' };
  }
  const context = await managerContext('content.resource.add');
  if (isFailure(context)) return context;
  const resource: ContentCatalogResource = {
    id: randomUUID(), kind, slug: slugFromLabel(cleanTitle), title: cleanTitle,
    summary: summary.trim(), audience, externalRef: null, imageUrl: null, mediaVersions: [],
  };
  if (!context) return { ok: true, resource, persisted: false };
  const catalog = await context.client.from('catalogs').select('id').eq('brand_id', context.brandId).single<{ id: string }>();
  if (catalog.error) return { ok: false, error: 'The catalog could not be loaded.' };
  const saved = await retryWrite(() => context.client.from('catalog_resources').insert({
    id: resource.id, brand_id: context.brandId, catalog_id: catalog.data.id,
    kind, slug: resource.slug, title: resource.title, summary: resource.summary, audience,
  }));
  if (saved.error) return { ok: false, error: saved.error.code === '23505' ? 'That resource already exists.' : 'The resource could not be saved.' };
  revalidatePath('/catalog');
  return { ok: true, resource, persisted: true };
}
export async function saveCatalogResourceImage(
  resourceId: string,
  imageUrl: string | null,
): Promise<Failure | { ok: true; imageUrl: string | null; persisted: boolean }> {
  const context = await managerContext('content.resource.image.save');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, imageUrl, persisted: false };
  if (!UUID.test(resourceId) || (imageUrl !== null && (imageUrl.length > 2048 || !imageUrl.startsWith('https://')))) {
    return { ok: false, error: 'The resource image is invalid.' };
  }
  const saved = await retryWrite(() => context.client.from('catalog_resources')
    .update({ image_url: imageUrl }).eq('id', resourceId).eq('brand_id', context.brandId));
  if (saved.error) return { ok: false, error: 'The resource image could not be saved.' };
  revalidatePath('/catalog');
  return { ok: true, imageUrl, persisted: true };
}
export async function linkCatalogResource(
  nodeId: string,
  resourceId: string,
  kind: ContentCatalogRelation['kind'],
): Promise<Failure | { ok: true; relation: ContentCatalogRelation; persisted: boolean }> {
  const relationKinds: ContentCatalogRelation['kind'][] = ['requires', 'follows', 'teaches', 'develops', 'covers', 'prerequisite', 'related', 'substitute'];
  if (!UUID.test(nodeId) || !UUID.test(resourceId) || !relationKinds.includes(kind)) return { ok: false, error: 'The relationship is invalid.' };
  const context = await managerContext('content.resource.link');
  if (isFailure(context)) return context;
  const relation: ContentCatalogRelation = { id: randomUUID(), sourceId: nodeId, targetId: resourceId, kind };
  if (!context) return { ok: true, relation, persisted: false };
  const [catalog, node, resource] = await Promise.all([
    context.client.from('catalogs').select('id').eq('brand_id', context.brandId).single<{ id: string }>(),
    context.client.from('catalog_nodes').select('id').eq('id', nodeId).eq('brand_id', context.brandId).maybeSingle(),
    context.client.from('catalog_resources').select('id').eq('id', resourceId).eq('brand_id', context.brandId).maybeSingle(),
  ]);
  if (catalog.error || node.error || resource.error || !node.data || !resource.data) return { ok: false, error: 'The linked records are not available in this tenant.' };
  const saved = await retryWrite(() => context.client.from('catalog_relations').insert({
    id: relation.id, brand_id: context.brandId, catalog_id: catalog.data.id,
    source_key: nodeId, target_key: resourceId, kind,
  }));
  if (saved.error) return { ok: false, error: saved.error.code === '23505' ? 'That relationship already exists.' : 'The relationship could not be saved.' };
  revalidatePath('/catalog');
  return { ok: true, relation, persisted: true };
}
