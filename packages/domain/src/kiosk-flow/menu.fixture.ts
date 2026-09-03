/**
 * The one menu every kiosk-flow test resolves against.
 *
 * Shared rather than restated per file so that a category renamed here fails
 * the suites that depend on it, instead of one copy quietly disagreeing with
 * another about what is on the menu.
 */

export const CATEGORIES = [
  { id: 'coffee', title: 'Coffee & Espresso' },
  { id: 'signature', title: 'Signature Lattes' },
  { id: 'boba', title: 'Boba' },
];

export const MENU = { categories: CATEGORIES, itemSlugs: ['six-pack', 'x', 'cortado'] };
export const CONTEXT = { menu: MENU };
