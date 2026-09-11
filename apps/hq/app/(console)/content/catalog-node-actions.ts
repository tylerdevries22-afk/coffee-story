'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import type { ContentCatalogPlacement } from '@/lib/content-model';

import {
  UUID,
  isFailure,
  managerContext,
  retryWrite,
  type Failure,
} from './actions-shared';

export async function moveCatalogNode(
  kind: 'folder' | 'offering',
  nodeId: string,
  parentId: string,
): Promise<Failure | { ok: true }> {
  if (!UUID.test(nodeId) || !UUID.test(parentId) || nodeId === parentId) {
    return { ok: false, error: 'Choose a valid destination folder.' };
  }
  const context = await managerContext('content.catalog.move');
  if (isFailure(context)) return context;
  if (!context) return { ok: true };
  if (kind === 'folder') {
    const folders = await context.client.from('menu_categories').select('id, parent_id')
      .eq('brand_id', context.brandId).returns<{ id: string; parent_id: string | null }[]>();
    if (folders.error) return { ok: false, error: 'The folder hierarchy could not be loaded.' };
    const parents = new Map((folders.data ?? []).map((folder) => [folder.id, folder.parent_id]));
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth <= 5; depth += 1) {
      if (cursor === nodeId) return { ok: false, error: 'A folder cannot be moved inside itself.' };
      cursor = parents.get(cursor) ?? null;
    }
    const result = await retryWrite(() => context.client.from('menu_categories')
      .update({ parent_id: parentId }).eq('id', nodeId).eq('brand_id', context.brandId));
    if (result.error) return { ok: false, error: 'The folder could not be moved.' };
  } else {
    const result = await retryWrite(() => context.client.from('menu_items')
      .update({ category_id: parentId }).eq('id', nodeId).eq('brand_id', context.brandId));
    if (result.error) return { ok: false, error: 'The offering could not be moved.' };
  }
  revalidatePath('/catalog');
  return { ok: true };
}
export async function addCatalogAlias(
  nodeId: string,
  parentId: string,
): Promise<Failure | { ok: true; placement: ContentCatalogPlacement; persisted: boolean }> {
  if (!UUID.test(nodeId) || !UUID.test(parentId) || nodeId === parentId) {
    return { ok: false, error: 'Choose a valid alias destination.' };
  }
  const context = await managerContext('content.catalog.alias.add');
  if (isFailure(context)) return context;
  const placement: ContentCatalogPlacement = {
    id: randomUUID(), nodeId, parentId, sortOrder: 1000, isPrimary: false,
  };
  if (!context) return { ok: true, placement, persisted: false };
  const catalog = await context.client.from('catalogs').select('id')
    .eq('brand_id', context.brandId).single<{ id: string }>();
  if (catalog.error) return { ok: false, error: 'The catalog could not be loaded.' };
  const saved = await retryWrite(() => context.client.from('catalog_placements').insert({
    id: placement.id, brand_id: context.brandId, catalog_id: catalog.data.id,
    parent_id: parentId, node_id: nodeId, sort_order: placement.sortOrder, is_primary: false,
  }));
  if (saved.error) return { ok: false, error: saved.error.code === '23505' ? 'That alias already exists.' : 'The alias could not be created.' };
  revalidatePath('/catalog');
  return { ok: true, placement, persisted: true };
}
export async function archiveCatalogNode(
  kind: 'folder' | 'offering',
  nodeId: string,
): Promise<Failure | { ok: true; persisted: boolean }> {
  if (!UUID.test(nodeId)) return { ok: false, error: 'Choose a valid catalog entry.' };
  const context = await managerContext('content.catalog.archive');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, persisted: false };
  if (kind === 'folder') {
    const children = await context.client.from('catalog_placements').select('id')
      .eq('brand_id', context.brandId).eq('parent_id', nodeId).limit(1);
    if (children.error) return { ok: false, error: 'The folder could not be checked.' };
    if ((children.data ?? []).length > 0) return { ok: false, error: 'Move or archive this folder’s contents first.' };
    const saved = await retryWrite(() => context.client.from('menu_categories')
      .update({ archived_at: new Date().toISOString() }).eq('brand_id', context.brandId).eq('id', nodeId));
    if (saved.error) return { ok: false, error: 'The folder could not be archived.' };
  } else {
    const now = new Date().toISOString();
    const [node, item] = await Promise.all([
      retryWrite(() => context.client.from('catalog_nodes').update({ archived_at: now })
        .eq('brand_id', context.brandId).eq('id', nodeId)),
      retryWrite(() => context.client.from('menu_items').update({ is_listed: false })
        .eq('brand_id', context.brandId).eq('id', nodeId)),
    ]);
    if (node.error || item.error) return { ok: false, error: 'The offering could not be archived.' };
  }
  revalidatePath('/catalog');
  return { ok: true, persisted: true };
}
