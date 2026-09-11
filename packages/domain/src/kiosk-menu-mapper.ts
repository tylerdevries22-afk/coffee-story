import type { DropRow, MenuCategoryRow, MenuItemRow } from '@platform/schema';

import { parseOptionGroups, parseSizes } from './kiosk-menu-parsers';
import type { KioskMenu, KioskMenuDrop, KioskMenuItem } from './kiosk-menu-types';

export type MenuRows = {
  categories: readonly (MenuCategoryRow & { parentId?: string | null })[];
  items: readonly MenuItemRow[];
  drops: readonly DropRow[];
};

/**
 * Live rows to the kiosk's menu.
 *
 * `single_item_id` is a uuid pointing at another row; it is resolved to that
 * row's slug here, because everything downstream -- the saving badge, the
 * option catalogue -- speaks slugs. A pack whose single was delisted resolves
 * to nothing and simply loses its badge.
 */
export function kioskMenuFromRows(rows: MenuRows): KioskMenu {
  const titleById = new Map(rows.categories.map((c) => [c.id, c.title]));
  const slugById = new Map(rows.items.map((i) => [i.id, i.slug]));
  const items: KioskMenuItem[] = [];
  for (const row of rows.items) {
    const categoryId = titleById.get(row.category_id);
    // An item whose category did not come back has nowhere to be drawn.
    if (categoryId === undefined) continue;
    if (!row.is_listed) continue;
    // Server-side pricing rejects a malformed modifier contract. Omitting the
    // same row here prevents the kiosk from presenting a path that can only
    // fail after payment begins, or from bypassing a required choice.
    const optionGroups = parseOptionGroups(row.modifiers);
    if (optionGroups === null) continue;
    const single = row.single_item_id === null ? undefined : slugById.get(row.single_item_id);
    items.push({
      id: row.slug,
      name: row.name,
      description: row.description,
      categoryId,
      sizes: parseSizes(row.sizes, row.base_price_cents),
      optionGroups,
      soldOutToday: row.is_86d,
      rotation: row.rotation,
      ...(row.image_url ? { imageUrl: row.image_url } : {}),
      ...(typeof row.pack_size === 'number' && row.pack_size > 0
        ? { packSize: row.pack_size }
        : {}),
      ...(row.choice_source ? { choiceSource: row.choice_source } : {}),
      ...(single ? { singleItemId: single } : {}),
      ...(row.pack_choice_slugs.length > 0 ? { eligibleItemIds: [...row.pack_choice_slugs] } : {}),
    });
  }
  const drops: KioskMenuDrop[] = [];
  for (const drop of rows.drops) {
    const itemId = slugById.get(drop.item_id);
    if (itemId === undefined) continue;
    const startsAt = Date.parse(drop.starts_at);
    const endsAt = Date.parse(drop.ends_at);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) continue;
    const revealAt = drop.reveal_at === null ? null : Date.parse(drop.reveal_at);
    drops.push({
      itemId,
      status: drop.status,
      revealAt: revealAt !== null && Number.isFinite(revealAt) ? revealAt : null,
      startsAt,
      endsAt,
    });
  }
  const hasHierarchy = rows.categories.some((category) => 'parentId' in category);
  const categories = rows.categories.map((c) => ({
    id: c.title, title: c.title, tagline: c.tagline,
    ...(hasHierarchy ? { stableId: c.id, parentStableId: c.parentId ?? null } : {}),
  }));
  return { categories, items, drops };
}
