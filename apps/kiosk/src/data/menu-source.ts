/**
 * What the flow resolver needs to know about the menu.
 *
 * Built from the compiled catalog today. When the kiosk moves onto live rows
 * this is the one function that changes: the resolver, the config editor and
 * every screen consume `KioskMenuFacts` and none of them care where it came
 * from.
 *
 * Categories are keyed by TITLE, because `menu_categories` (0003) has no slug
 * and a uuid differs per environment -- so the title is the only thing a tenant
 * file can name a category by. See `kiosk-flow.ts`.
 */
import type { KioskMenuFacts } from '@platform/domain';

import { MENU_CATEGORY_META, MENU_ITEMS } from '@/data/catalog';

export function menuFactsFromCatalog(): KioskMenuFacts {
  return {
    categories: MENU_CATEGORY_META.map((meta) => ({ id: meta.title, title: meta.title })),
    itemSlugs: MENU_ITEMS.map((item) => item.id),
  };
}

/** The items under one category title. */
export function itemsInCategory(title: string) {
  const meta = MENU_CATEGORY_META.find((entry) => entry.title === title);
  if (!meta) return [];
  return MENU_ITEMS.filter((item) => item.category === meta.id);
}
