'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import {
  isMenuItemDraft,
  validateMenuItemDraft,
  type ContentMenuItem,
  type MenuItemDraft,
} from '@/lib/content-model';

import {
  UUID,
  isFailure,
  managerContext,
  menuItemOf,
  menuMediaVersions,
  retryWrite,
  type Failure,
  type MenuItemRow,
} from './actions-shared';

export async function saveMenuItem(
  input: unknown,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; item: ContentMenuItem; persisted: boolean }> {
  if (!isMenuItemDraft(input)) return { ok: false, error: 'The menu item payload is invalid.' };
  const draft: MenuItemDraft = input;
  const context = await managerContext('content.menu_item.save');
  if (isFailure(context)) return context;
  if (!context) {
    const previewIssues = validateMenuItemDraft(
      { ...draft, imageUrl: null },
      new Set(draft.categoryId ? [draft.categoryId] : []),
    );
    if (previewIssues.length > 0) return { ok: false, error: previewIssues.join(' ') };
    return { ok: true, persisted: false, item: { ...draft, id: draft.id ?? `preview-${randomUUID()}`, updatedAt: new Date().toISOString(), mediaVersions: [] } };
  }
  if (draft.id && (!UUID.test(draft.id) || !expectedUpdatedAt)) {
    return { ok: false, error: 'Reload this menu item before saving it.' };
  }
  const menu = await context.client.from('menus').select('id').eq('brand_id', context.brandId)
    .order('created_at').limit(1).single<{ id: string }>();
  if (menu.error) return { ok: false, error: 'The tenant menu could not be loaded.' };
  const categories = await context.client.from('menu_categories').select('id').eq('menu_id', menu.data.id)
    .returns<{ id: string }[]>();
  if (categories.error) return { ok: false, error: 'The menu categories could not be loaded.' };
  const issues = validateMenuItemDraft(draft, new Set((categories.data ?? []).map((row) => row.id)));
  if (issues.length > 0) return { ok: false, error: issues.join(' ') };

  const values = {
    name: draft.name.trim(),
    slug: draft.slug,
    description: draft.description.trim(),
    category_id: draft.categoryId,
    base_price_cents: draft.basePriceCents,
    sizes: draft.sizes.map((size) => ({
      slug: size.slug, label: size.label.trim(), price_cents: size.priceCents,
    })),
    modifiers: draft.optionGroups,
    image_url: draft.imageUrl,
    catalog_audience: draft.audience,
    is_listed: draft.isListed,
    is_86d: draft.is86d,
    sort_order: draft.sortOrder,
  };
  const fields = 'id, name, slug, description, category_id, base_price_cents, sizes, modifiers, image_url, catalog_audience, is_listed, is_86d, sort_order, updated_at';
  let result;
  if (draft.id) {
    const itemId = draft.id;
    result = await retryWrite(() => {
      let query = context.client.from('menu_items').update(values)
        .eq('id', itemId).eq('brand_id', context.brandId);
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
      return query.select(fields).maybeSingle<MenuItemRow>();
    });
    if (!result.error && !result.data) {
      return { ok: false, error: 'This item changed in another session. Reload before saving.' };
    }
  } else {
    const id = randomUUID();
    result = await retryWrite(() => context.client.from('menu_items').insert({
      id, brand_id: context.brandId, menu_id: menu.data.id, ...values,
    }).select(fields).single<MenuItemRow>());
  }
  if (result.error || !result.data) {
    const duplicate = result.error?.code === '23505';
    return { ok: false, error: duplicate ? 'That item slug is already in use.' : 'The menu item could not be saved.' };
  }
  revalidatePath('/content');
  revalidatePath('/menu');
  const mediaVersions = await menuMediaVersions(context, result.data.id);
  return { ok: true, persisted: true, item: menuItemOf(result.data, mediaVersions) };
}
