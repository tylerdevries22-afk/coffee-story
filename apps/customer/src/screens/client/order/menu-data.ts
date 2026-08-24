/**
 * The catalog, arranged the way the menu screen renders it.
 *
 * Lives beside the screen rather than in `features/order` because it imports
 * `data/catalog.ts`, which imports the item photography — the feature modules
 * stay free of asset imports so `node:test` can reach them.
 */
import { MENU_CATEGORY_META, MENU_ITEMS, type MenuCategoryId, type MenuItem } from '@/data/catalog';
import { isItemSoldOut } from '@/features/order/menu-availability';

export type MenuSection = {
  id: MenuCategoryId;
  title: string;
  tagline: string;
  items: readonly MenuItem[];
};

/** Categories in menu order, with the empty ones dropped. */
export function menuSections(liveSoldOutIds: ReadonlySet<string> | null = null): MenuSection[] {
  return MENU_CATEGORY_META.map((category) => ({
    id: category.id,
    title: category.title,
    tagline: category.tagline,
    items: MENU_ITEMS
      .filter((item) => item.category === category.id)
      .map((item) => ({
        ...item,
        soldOutToday: isItemSoldOut(item.id, item.soldOutToday, liveSoldOutIds),
      })),
  })).filter((section) => section.items.length > 0);
}

export function findMenuItem(itemId: string): MenuItem | undefined {
  return MENU_ITEMS.find((item) => item.id === itemId);
}
