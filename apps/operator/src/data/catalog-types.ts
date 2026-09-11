import type { CatalogSize } from '@platform/domain';

export type MenuCategoryId =
  | 'coffee'
  | 'signature'
  | 'tea-matcha'
  | 'boba'
  | 'ades-smoothies'
  | 'sandwiches'
  | 'sweets';

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  image: number;
  category: MenuCategoryId;
  /**
   * Each size carries the slug an order is actually made against.
   */
  sizes: readonly CatalogSize[];
};

export const MENU_CATEGORY_META: readonly { id: MenuCategoryId; title: string; tagline: string }[] = [
  { id: 'coffee', title: 'Coffee & Espresso', tagline: 'Corvus Coffee, pulled with care' },
  { id: 'signature', title: 'Signature Lattes', tagline: 'The drinks that made us famous' },
  { id: 'tea-matcha', title: 'Tea & Matcha', tagline: 'Whisked, brewed, and spiced' },
  { id: 'boba', title: 'Boba', tagline: 'Bubble tea with brown sugar boba' },
  { id: 'ades-smoothies', title: 'Sparkling Ades & Smoothies', tagline: 'Bright, cold, and refreshing' },
  { id: 'sandwiches', title: 'Sandwiches', tagline: 'Halal-friendly, made to order' },
  { id: 'sweets', title: 'Sweets & Desserts', tagline: 'Late-night cravings, sorted' },
] as const;

/** Standard three-size drink ladder around a 16 oz base price. */
export function drinkSizes(id: string, base: number) {
  return [
    { slug: `${id}-12`, ounces: 12, priceCents: (base - 1) * 100 },
    { slug: `${id}-16`, ounces: 16, priceCents: base * 100 },
    { slug: `${id}-20`, ounces: 20, priceCents: (base + 1) * 100 },
  ] as const;
}

/** Food and single-serve items. */
export function eachSize(id: string, dollars: number) {
  return [{ slug: id, priceCents: dollars * 100 }] as const;
}
