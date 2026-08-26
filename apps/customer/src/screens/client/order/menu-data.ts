/**
 * The catalog, arranged the way the menu screen renders it.
 *
 * Lives beside the screen rather than in `features/order` because it imports
 * `data/catalog.ts`, which imports the item photography — the feature modules
 * stay free of asset imports so `node:test` can reach them.
 */
import type { MenuCategory, MenuCategoryId, MenuItem } from '@/data/catalog';
import { isItemSoldOut } from '@/features/order/menu-availability';

export type MenuSection = {
  id: MenuCategoryId;
  title: string;
  tagline: string;
  items: readonly MenuItem[];
};

/** Categories in menu order, with the empty ones dropped. */
export function menuSections(
  categories: readonly MenuCategory[],
  items: readonly MenuItem[],
): MenuSection[] {
  return categories.map((category) => ({
    id: category.id,
    title: category.title,
    tagline: category.tagline,
    items: items
      .filter((item) => item.category === category.id)
      .map((item) => ({ ...item, soldOutToday: isItemSoldOut(item.id, item.soldOutToday, null) })),
  })).filter((section) => section.items.length > 0);
}

export function findMenuItem(items: readonly MenuItem[], itemId: string): MenuItem | undefined {
  return items.find((item) => item.id === itemId);
}
