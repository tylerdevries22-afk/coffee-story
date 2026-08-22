/**
 * Server-side line pricing. The client sends slugs — item, size, modifier
 * choices — and NEVER a price; every cent is recomputed here from the
 * menu_items row, so a tampered request can only buy what the menu sells at
 * what the menu charges.
 *
 * The JSONB shapes are the ones 0003 documents: sizes as
 * [{slug,label,price_cents}], modifiers as the customer app's option-group
 * model ({id,name,select,required,maxChoices,dependsOn,choices:[{id,name,
 * priceDeltaCents}]}). Pure functions; the DB rows are inputs.
 */

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

type Size = { slug: string; label: string; price_cents: number };
type Choice = { id: string; name: string; priceDeltaCents: number };
type Group = {
  id: string;
  name: string;
  select: 'single' | 'multi';
  required: boolean;
  maxChoices: number;
  dependsOn?: { groupId: string; choiceIds: readonly string[] };
  choices: Choice[];
};

export const MAX_LINE_QUANTITY = 50;

function parseSizes(item: MenuItemPricing): Size[] {
  const raw = item.sizes;
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has malformed sizes.`);
  return raw.map((entry) => {
    const size = entry as Partial<Size>;
    if (typeof size.slug !== 'string' || typeof size.label !== 'string'
      || typeof size.price_cents !== 'number' || !Number.isInteger(size.price_cents) || size.price_cents < 0) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed size entry.`);
    }
    return { slug: size.slug, label: size.label, price_cents: size.price_cents };
  });
}

function parseGroups(item: MenuItemPricing): Group[] {
  const raw = item.modifiers;
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has malformed modifiers.`);
  return raw.map((entry) => {
    const group = entry as Partial<Group> & { choices?: unknown };
    if (typeof group.id !== 'string' || typeof group.name !== 'string'
      || (group.select !== 'single' && group.select !== 'multi')
      || typeof group.required !== 'boolean'
      || typeof group.maxChoices !== 'number' || !Array.isArray(group.choices)) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed option group.`);
    }
    const choices = group.choices.map((candidate) => {
      const choice = candidate as Partial<Choice>;
      if (typeof choice.id !== 'string' || typeof choice.name !== 'string'
        || typeof choice.priceDeltaCents !== 'number' || !Number.isInteger(choice.priceDeltaCents)) {
        throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed option choice.`);
      }
      return { id: choice.id, name: choice.name, priceDeltaCents: choice.priceDeltaCents };
    });
    return {
      id: group.id,
      name: group.name,
      select: group.select,
      required: group.required,
      maxChoices: group.maxChoices,
      dependsOn: group.dependsOn,
      choices,
    };
  });
}

/** Mirrors the app's visibility rule: a dependent group is in play only when its trigger choice is selected. */
function isGroupVisible(group: Group, chosenByGroup: ReadonlyMap<string, readonly string[]>): boolean {
  if (!group.dependsOn) return true;
  const chosen = chosenByGroup.get(group.dependsOn.groupId) ?? [];
  return chosen.some((id) => group.dependsOn!.choiceIds.includes(id));
}

export function priceLine(item: MenuItemPricing, line: PricedLineRequest): PricedLine {
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
    throw new MenuPricingError('quantity_invalid', `Quantity must be 1..${MAX_LINE_QUANTITY}.`);
  }

  const sizes = parseSizes(item);
  const optionNames: string[] = [];
  let unit: number;
  if (sizes.length > 0) {
    const size = sizes.find((candidate) => candidate.slug === line.sizeSlug);
    if (!line.sizeSlug) throw new MenuPricingError('size_required', `${item.name} needs a size.`);
    if (!size) throw new MenuPricingError('size_unknown', `${item.name} has no size "${line.sizeSlug}".`);
    unit = size.price_cents;
    optionNames.push(size.label);
  } else {
    if (line.sizeSlug) throw new MenuPricingError('size_unknown', `${item.name} has no sizes.`);
    unit = item.base_price_cents;
  }

  const groups = parseGroups(item);
  const wanted = line.modifierSlugs ?? [];
  if (new Set(wanted).size !== wanted.length) {
    throw new MenuPricingError('modifier_invalid', 'A modifier choice repeats.');
  }
  const choiceIndex = new Map<string, { group: Group; choice: Choice }>();
  for (const group of groups) {
    for (const choice of group.choices) choiceIndex.set(choice.id, { group, choice });
  }
  const chosenByGroup = new Map<string, string[]>();
  for (const id of wanted) {
    const found = choiceIndex.get(id);
    if (!found) throw new MenuPricingError('modifier_unknown', `${item.name} has no option "${id}".`);
    const list = chosenByGroup.get(found.group.id) ?? [];
    list.push(id);
    chosenByGroup.set(found.group.id, list);
  }

  for (const group of groups) {
    const chosen = chosenByGroup.get(group.id) ?? [];
    const visible = isGroupVisible(group, chosenByGroup);
    if (!visible && chosen.length > 0) {
      throw new MenuPricingError('modifier_invalid', `${group.name} does not apply to this configuration.`);
    }
    const cap = group.select === 'single' ? 1 : group.maxChoices;
    if (chosen.length > cap) {
      throw new MenuPricingError('modifier_invalid', `${group.name} allows at most ${cap} choice${cap === 1 ? '' : 's'}.`);
    }
    if (visible && group.required && chosen.length === 0) {
      throw new MenuPricingError('modifier_invalid', `${group.name} needs a choice.`);
    }
  }

  for (const id of wanted) {
    const { choice } = choiceIndex.get(id)!;
    // Negative deltas never price a drink down (option-model rule).
    unit += Math.max(0, choice.priceDeltaCents);
    optionNames.push(choice.name);
  }

  return {
    unitPriceCents: unit,
    lineTotalCents: unit * line.quantity,
    optionNames,
  };
}
