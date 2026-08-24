/**
 * The Tea & Matcha shelf on the client home.
 *
 * Six of the ten, curated for the page rather than taken off the top of the
 * category. Pure and asset-free so `node:test` can reach it.
 *
 * The order is the running order, and it matters twice: rows alternate their
 * bleed off the index, and the first two rows are what sells the section.
 *
 * Chosen for what a *clear glass* can show. Every render is the drink standing
 * in a tall glass, so the shelf is picked for six distinct colours and for the
 * two teas that are not matcha, rather than for six of the same green:
 *
 *   matcha-latte           the anchor — green over white
 *   strawberry-matcha      pink over green over milk, the most layered we pour
 *   ube-matcha             violet over green over milk
 *   honey-lavender-matcha  pale lilac over sage
 *   adeni-chai             warm amber, and the house's own signature
 *   london-fog             creamy grey, so the shelf is not six matchas
 *
 * Held back for the see-all: loose-leaf-tea (brewed hot, wrong in an iced
 * glass), chai-latte (adeni-chai already carries chai, and carries it better),
 * orange-blossom-matcha and spanish-matcha (both read as another green).
 *
 * Deliberately not a feature flag: `TenantFeatures` is a closed union and a
 * shelf order is not a capability. When it needs to move into `brand.json` the
 * id list is already a parameter, and only the call site changes.
 */
export const TEA_MATCHA_CATEGORY = 'tea-matcha';

export const TEA_MATCHA_FEATURE_IDS = [
  'matcha-latte',
  'strawberry-matcha',
  'ube-matcha',
  'honey-lavender-matcha',
  'adeni-chai',
  'london-fog',
] as const;

/** How many rows the shelf shows before it hands off to the category. */
export const TEA_MATCHA_SHELF_SIZE = 6;

/**
 * The shelf, in the declared order.
 *
 * Unknown ids and ids from another category are dropped rather than thrown, the
 * way `resolveTokens` drops a malformed tenant value field by field: a
 * franchise typo should cost one row, not the home screen.
 */
export function teaMatchaShelf<T extends { id: string; category: string }>(
  items: readonly T[],
  ids: readonly string[] = TEA_MATCHA_FEATURE_IDS,
): T[] {
  return ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is T => item !== undefined && item.category === TEA_MATCHA_CATEGORY);
}

/** Everything in the category, which is what the see-all link counts. */
export function teaMatchaCount<T extends { category: string }>(items: readonly T[]): number {
  return items.filter((item) => item.category === TEA_MATCHA_CATEGORY).length;
}

/**
 * The row tag, borrowed from the category's own three words ("Whisked, brewed,
 * and spiced") so the tag says something the title does not.
 */
export function teaMatchaTag(id: string): string {
  if (id.includes('matcha')) return 'Whisked';
  if (id.includes('chai')) return 'Spiced';
  return 'Brewed';
}

/** Counted, never written down, so the label stays true when the menu changes. */
export function teaMatchaSeeAllLabel(total: number): string {
  return `See all ${total}  ›`;
}
