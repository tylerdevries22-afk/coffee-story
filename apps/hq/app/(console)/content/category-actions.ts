'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { slugFromLabel, type ContentCategory } from '@/lib/content-model';

import {
  UUID,
  isFailure,
  managerContext,
  retryWrite,
  type Failure,
} from './actions-shared';

export async function addMenuCategory(
  title: string,
  tagline: string,
  parentId: string | null = null,
): Promise<Failure | { ok: true; category: ContentCategory; persisted: boolean }> {
  if (typeof title !== 'string' || typeof tagline !== 'string') {
    return { ok: false, error: 'The category payload is invalid.' };
  }
  const cleanTitle = title.trim();
  const cleanTagline = tagline.trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 80 || cleanTagline.length > 160) {
    return { ok: false, error: 'Category names need 2–80 characters; taglines can use up to 160.' };
  }
  const context = await managerContext('content.category.add');
  if (isFailure(context)) return context;
  if (parentId !== null && !UUID.test(parentId) && !parentId.startsWith('preview-')) {
    return { ok: false, error: 'The parent folder is invalid.' };
  }
  const preview: ContentCategory = {
    id: `preview-${randomUUID()}`, title: cleanTitle, tagline: cleanTagline,
    slug: slugFromLabel(cleanTitle), parentId, imageUrl: null, audience: 'public',
    archived: false, sortOrder: 1000, mediaVersions: [],
  };
  if (!context) return { ok: true, category: preview, persisted: false };
  const menu = await context.client.from('menus').select('id').eq('brand_id', context.brandId)
    .order('created_at').limit(1).single<{ id: string }>();
  if (menu.error) return { ok: false, error: 'The tenant menu could not be loaded.' };
  const highest = await context.client.from('menu_categories').select('sort_order')
    .eq('menu_id', menu.data.id).order('sort_order', { ascending: false }).limit(1)
    .maybeSingle<{ sort_order: number }>();
  if (highest.error) return { ok: false, error: 'The category order could not be loaded.' };
  const category: ContentCategory = {
    id: randomUUID(), title: cleanTitle, tagline: cleanTagline,
    slug: slugFromLabel(cleanTitle), parentId, imageUrl: null, audience: 'public',
    archived: false, sortOrder: (highest.data?.sort_order ?? 0) + 10, mediaVersions: [],
  };
  const saved = await retryWrite(() => context.client.from('menu_categories').insert({
    id: category.id, brand_id: context.brandId, menu_id: menu.data.id,
    title: category.title, tagline: category.tagline, slug: category.slug,
    parent_id: category.parentId, audience: category.audience, sort_order: category.sortOrder,
  }));
  if (saved.error) return { ok: false, error: 'The category could not be created.' };
  revalidatePath('/content');
  return { ok: true, category, persisted: true };
}
export async function saveMenuCategory(
  categoryId: string,
  title: string,
  tagline: string,
  parentId: string | null,
  audience: ContentCategory['audience'],
  imageUrl: string | null,
): Promise<Failure | { ok: true; category: ContentCategory; persisted: boolean }> {
  if (typeof title !== 'string' || typeof tagline !== 'string' || typeof categoryId !== 'string'
      || categoryId.length < 1 || categoryId.length > 100) {
    return { ok: false, error: 'The category payload is invalid.' };
  }
  const cleanTitle = title.trim();
  const cleanTagline = tagline.trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 80 || cleanTagline.length > 160) {
    return { ok: false, error: 'Category names need 2–80 characters; taglines can use up to 160.' };
  }
  const context = await managerContext('content.category.save');
  if (isFailure(context)) return context;
  if (!['public', 'staff', 'manager', 'owner'].includes(audience)) return { ok: false, error: 'The audience is invalid.' };
  const preview: ContentCategory = {
    id: categoryId, title: cleanTitle, tagline: cleanTagline, slug: slugFromLabel(cleanTitle),
    parentId, imageUrl, audience, archived: false, sortOrder: 0, mediaVersions: [],
  };
  if (!context) return { ok: true, category: preview, persisted: false };
  if (!UUID.test(categoryId)) return { ok: false, error: 'Reload this category before saving it.' };
  if (parentId) {
    const hierarchy = await context.client.from('menu_categories').select('id, parent_id')
      .eq('brand_id', context.brandId).returns<{ id: string; parent_id: string | null }[]>();
    if (hierarchy.error) return { ok: false, error: 'The folder hierarchy could not be checked.' };
    const parents = new Map((hierarchy.data ?? []).map((folder) => [folder.id, folder.parent_id]));
    let cursor: string | null = parentId;
    let depth = 1;
    while (cursor) {
      if (cursor === categoryId) return { ok: false, error: 'A folder cannot contain itself.' };
      cursor = parents.get(cursor) ?? null; depth += 1;
    }
    if (depth > 5) return { ok: false, error: 'Catalog folders support at most five levels.' };
  }
  const result = await retryWrite(() => context.client.from('menu_categories')
    .update({ title: cleanTitle, tagline: cleanTagline, slug: slugFromLabel(cleanTitle), parent_id: parentId, audience, image_url: imageUrl })
    .eq('id', categoryId).eq('brand_id', context.brandId)
    .select('id, title, tagline, slug, parent_id, image_url, audience, archived_at, sort_order')
    .maybeSingle<{ id: string; title: string; tagline: string; slug: string; parent_id: string | null; image_url: string | null; audience: ContentCategory['audience']; archived_at: string | null; sort_order: number }>());
  if (result.error || !result.data) return { ok: false, error: 'The category could not be saved.' };
  revalidatePath('/content');
  return {
    ok: true,
    persisted: true,
    category: {
      id: result.data.id, title: result.data.title,
      tagline: result.data.tagline, slug: result.data.slug, parentId: result.data.parent_id,
      imageUrl: result.data.image_url, audience: result.data.audience,
      archived: result.data.archived_at !== null, sortOrder: result.data.sort_order,
      mediaVersions: [],
    },
  };
}
