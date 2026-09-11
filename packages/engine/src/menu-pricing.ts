import {
  isGroupVisible,
  parseGroups,
  parseSizes,
} from './menu-pricing-catalog';
import {
  MAX_LINE_QUANTITY,
  MenuPricingError,
  type Choice,
  type Group,
  type MenuItemPricing,
  type PricedLine,
  type PricedLineRequest,
} from './menu-pricing-types';

export {
  MAX_LINE_QUANTITY,
  MenuPricingError,
  type MenuItemPricing,
  type PricedLine,
  type PricedLineRequest,
} from './menu-pricing-types';

export function priceLine(item: MenuItemPricing, line: PricedLineRequest): PricedLine {
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
    throw new MenuPricingError('quantity_invalid', `Quantity must be 1..${MAX_LINE_QUANTITY}.`);
  }
  if (!Number.isInteger(item.base_price_cents) || item.base_price_cents < 0) {
    throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed base price.`);
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
    const indexed = choiceIndex.get(id);
    if (!indexed) throw new MenuPricingError('modifier_unknown', `${item.name} has no option "${id}".`);
    // Negative deltas never price a drink down (option-model rule).
    unit += Math.max(0, indexed.choice.priceDeltaCents);
    optionNames.push(indexed.choice.name);
  }

  return {
    unitPriceCents: unit,
    lineTotalCents: unit * line.quantity,
    optionNames,
  };
}
