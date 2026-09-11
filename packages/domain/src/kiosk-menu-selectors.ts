import type { KioskMenuFacts, KioskNodeTarget } from './kiosk-flow';
import { dropVisibility, type KioskMenu, type KioskMenuItem } from './kiosk-menu-types';

/** What the flow resolver needs to know, from a menu of any provenance. */
export function menuFactsFrom(menu: KioskMenu): KioskMenuFacts {
  const imageUrls: Record<string, string> = {};
  for (const item of menu.items) {
    if (item.imageUrl) imageUrls[item.id] = item.imageUrl;
  }
  return {
    categories: menu.categories.map((c) => ({
      id: c.stableId ?? c.id, title: c.title,
      ...(c.stableId ? {
        aliases: [c.id], parentId: c.parentStableId ?? null,
        hasItems: menu.items.some((item) => item.categoryId === c.id),
      } : {}),
    })),
    itemSlugs: menu.items.map((i) => i.id),
    ...(Object.keys(imageUrls).length > 0 ? { imageUrls } : {}),
  };
}

/** The items under one category title, in menu order. */
export function itemsInCategoryOf(menu: KioskMenu, title: string): readonly KioskMenuItem[] {
  const category = menu.categories.find((candidate) => candidate.id === title || candidate.stableId === title);
  return menu.items.filter((item) => item.categoryId === (category?.id ?? title));
}

/** Items represented by an entry target, including a direct item tile. */
export function itemsForTarget(
  menu: KioskMenu,
  target: KioskNodeTarget | null | undefined,
): readonly KioskMenuItem[] {
  if (target?.kind === 'category') return itemsInCategoryOf(menu, target.categoryId);
  if (target?.kind === 'item') return menu.items.filter((item) => item.id === target.itemSlug);
  return [];
}

/** Whether choosing this item still requires a size/modifier screen. */
export function itemNeedsConfiguration(
  item: Pick<KioskMenuItem, 'sizes' | 'optionGroups'>,
): boolean {
  return item.sizes.length > 1 || item.optionGroups.length > 0;
}

/** The containers under one category title. */
export function packsInCategoryOf(menu: KioskMenu, title: string): readonly KioskMenuItem[] {
  return itemsInCategoryOf(menu, title).filter((item) => item.packSize !== undefined);
}

/**
 * What may go in this pack right now: the client mirror of `app.pack_choices`
 * (0029).
 *
 * The compiled version took a `pack` argument and ignored it, so a 'lineup'
 * pack and a 'static' pack offered the same list and this week's rotation
 * never narrowed anything -- the one behaviour the column exists to express.
 * With live rows the drop window is readable, so the argument is honoured:
 * 'static' offers every single, 'lineup' offers the permanent ones plus
 * whatever is in an orderable drop.
 *
 * 86'd items are excluded here, which is what makes a prep station's "batch
 * done" reach an open configurator: clearing `is_86d` replicates, the menu
 * re-maps, and the item returns to this list.
 */
export function packChoicesOf(
  menu: KioskMenu,
  pack: Pick<KioskMenuItem, 'packSize' | 'choiceSource' | 'eligibleItemIds'>,
  atMs: number,
): readonly KioskMenuItem[] {
  const orderable = new Set(
    menu.drops
      .filter((drop) => dropVisibility(drop, atMs) === 'orderable')
      .map((drop) => drop.itemId),
  );
  const eligible = new Set(pack.eligibleItemIds ?? []);
  return menu.items.filter((item) => {
    if (!eligible.has(item.id)) return false;
    if (item.packSize !== undefined) return false;
    if (item.soldOutToday) return false;
    if (pack.choiceSource === 'static') return true;
    return item.rotation === 'permanent' || orderable.has(item.id);
  });
}

/** Earliest clock-only transition that can change a lineup pack's choices. */
export function nextPackChoiceBoundary(
  menu: KioskMenu,
  pack: Pick<KioskMenuItem, 'choiceSource' | 'eligibleItemIds'>,
  atMs: number,
): number | null {
  if (pack.choiceSource !== 'lineup') return null;
  const eligible = new Set(pack.eligibleItemIds ?? []);
  let next: number | null = null;
  for (const drop of menu.drops) {
    if (!eligible.has(drop.itemId)) continue;
    if (drop.status === 'draft' || drop.status === 'cancelled') continue;
    for (const boundary of [drop.startsAt, drop.endsAt]) {
      if (boundary > atMs && (next === null || boundary < next)) next = boundary;
    }
  }
  return next;
}
