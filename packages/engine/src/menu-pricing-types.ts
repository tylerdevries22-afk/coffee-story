export class MenuPricingError extends Error {
  readonly code:
    | 'quantity_invalid'
    | 'size_required'
    | 'size_unknown'
    | 'modifier_unknown'
    | 'modifier_invalid'
    | 'catalog_invalid';

  constructor(code: MenuPricingError['code'], message: string) {
    super(message);
    this.name = 'MenuPricingError';
    this.code = code;
  }
}

export type MenuItemPricing = {
  slug: string;
  name: string;
  base_price_cents: number;
  sizes: unknown;
  modifiers: unknown;
};

export type PricedLineRequest = {
  sizeSlug?: string | null;
  quantity: number;
  modifierSlugs?: string[];
};

export type PricedLine = {
  unitPriceCents: number;
  lineTotalCents: number;
  /** The size label plus chosen option names, for the cart snapshot. */
  optionNames: string[];
};

export type Size = { slug: string; label: string; price_cents: number };
export type Choice = { id: string; name: string; priceDeltaCents: number };
export type Group = {
  id: string;
  name: string;
  select: 'single' | 'multi';
  required: boolean;
  maxChoices: number;
  dependsOn?: { groupId: string; choiceIds: readonly string[] };
  choices: Choice[];
};

export const MAX_LINE_QUANTITY = 50;
