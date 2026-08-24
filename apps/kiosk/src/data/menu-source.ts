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

/**
 * The containers a tenant sells, if any.
 *
 * Empty for a shop whose SKU is a drink, which is why the container family is
 * a per-tenant choice and never inferred from the menu: a coffee shop that adds
 * one box of pastries has not changed what it is.
 */
export function packsInCategory(title: string) {
  return itemsInCategory(title).filter((item) => typeof item.packSize === 'number' && item.packSize > 0);
}

/**
 * What may go in a pack right now.
 *
 * The client mirror of `app.pack_choices` (0029): everything listed, not 86'd,
 * and not itself a pack. The SQL additionally narrows a 'lineup' source to
 * items that are permanent or in an orderable drop -- that part needs the live
 * rows, so a compiled catalog returns the permanent set and the server remains
 * the authority.
 */
export function packChoicesFor(pack: { packSize?: number; choiceSource?: 'lineup' | 'static' }) {
  return MENU_ITEMS.filter((item) =>
    item.soldOutToday !== true && typeof item.packSize !== 'number');
}
