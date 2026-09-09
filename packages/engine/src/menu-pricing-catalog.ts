import {
  MenuPricingError,
  type Choice,
  type Group,
  type MenuItemPricing,
  type Size,
} from './menu-pricing-types';

export function parseSizes(item: MenuItemPricing): Size[] {
  const raw = item.sizes;
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has malformed sizes.`);
  const seen = new Set<string>();
  return raw.map((entry) => {
    const size = entry as Partial<Size>;
    if (typeof size.slug !== 'string' || typeof size.label !== 'string'
      || typeof size.price_cents !== 'number' || !Number.isInteger(size.price_cents) || size.price_cents < 0) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed size entry.`);
    }
    if (seen.has(size.slug)) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} repeats size "${size.slug}".`);
    }
    seen.add(size.slug);
    return { slug: size.slug, label: size.label, price_cents: size.price_cents };
  });
}

export function parseGroups(item: MenuItemPricing): Group[] {
  const raw = item.modifiers;
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has malformed modifiers.`);
  const groupIds = new Set<string>();
  const choiceIds = new Set<string>();
  const groups = raw.map((entry) => {
    const group = entry as Partial<Group> & { choices?: unknown };
    if (typeof group.id !== 'string' || typeof group.name !== 'string'
      || (group.select !== 'single' && group.select !== 'multi')
      || typeof group.required !== 'boolean'
      || typeof group.maxChoices !== 'number'
      || !Number.isInteger(group.maxChoices) || group.maxChoices < 1
      || !Array.isArray(group.choices) || group.choices.length === 0) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed option group.`);
    }
    if (groupIds.has(group.id)) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} repeats option group "${group.id}".`);
    }
    groupIds.add(group.id);
    const choices = group.choices.map((candidate) => {
      const choice = candidate as Partial<Choice>;
      if (typeof choice.id !== 'string' || typeof choice.name !== 'string'
        || typeof choice.priceDeltaCents !== 'number' || !Number.isInteger(choice.priceDeltaCents)) {
        throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has a malformed option choice.`);
      }
      if (choiceIds.has(choice.id)) {
        throw new MenuPricingError('catalog_invalid', `Item ${item.slug} repeats option choice "${choice.id}".`);
      }
      choiceIds.add(choice.id);
      return { id: choice.id, name: choice.name, priceDeltaCents: choice.priceDeltaCents };
    });
    return {
      id: group.id,
      name: group.name,
      select: group.select,
      required: group.required,
      maxChoices: group.maxChoices,
      dependsOn: parseDependency(item.slug, group.dependsOn),
      choices,
    };
  });
  for (const group of groups) {
    if (!group.dependsOn) continue;
    const parent = groups.find((candidate) => candidate.id === group.dependsOn?.groupId);
    if (!parent || parent.id === group.id
      || group.dependsOn.choiceIds.some((id) => !parent.choices.some((choice) => choice.id === id))) {
      throw new MenuPricingError('catalog_invalid', `Item ${item.slug} has an invalid option dependency.`);
    }
  }
  return groups;
}

function parseDependency(slug: string, value: unknown): Group['dependsOn'] {
  if (value === undefined) return undefined;
  const dependency = value as { groupId?: unknown; choiceIds?: unknown };
  if (typeof dependency?.groupId !== 'string' || !Array.isArray(dependency.choiceIds)
    || dependency.choiceIds.length === 0
    || dependency.choiceIds.some((id) => typeof id !== 'string')) {
    throw new MenuPricingError('catalog_invalid', `Item ${slug} has a malformed option dependency.`);
  }
  return { groupId: dependency.groupId, choiceIds: dependency.choiceIds as string[] };
}

/** Mirrors the app's visibility rule: a dependent group is in play only when its trigger choice is selected. */
export function isGroupVisible(group: Group, chosenByGroup: ReadonlyMap<string, readonly string[]>): boolean {
  const dependency = group.dependsOn;
  if (!dependency) return true;
  const chosen = chosenByGroup.get(dependency.groupId) ?? [];
  return chosen.some((id) => dependency.choiceIds.includes(id));
}
