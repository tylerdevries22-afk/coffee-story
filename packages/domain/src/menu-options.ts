/**
 * The customizations a guest picks on a menu item before it reaches the bag.
 *
 * Pure by construction: no asset imports, and nothing here reaches into
 * `data/catalog.ts`, which imports .webp files and is therefore unreachable
 * from `node:test`. Callers hand this module an item id and a category, never
 * a `MenuItem`. `data/add-ons.ts` follows the same rule and is the single
 * source of truth for extra pricing, so an extra shot costs the same here as
 * it does on the staff register.
 */
import { DEMO_ADD_ONS } from './add-ons';

/**
 * The menu's category vocabulary.
 *
 * Lives here rather than beside a tenant's catalog: which categories take
 * drink options is a property of the option model, not of one shop's menu, and
 * the kiosk needs it without importing an app's asset-laden catalog.
 */
export type MenuCategoryId =
  | 'coffee' | 'signature' | 'tea-matcha' | 'boba'
  | 'ades-smoothies' | 'sandwiches' | 'sweets';

export type OptionSelect = 'single' | 'multi';

export type OptionChoice = {
  id: string;
  name: string;
  /**
   * Added to the line's unit price, in integer cents. Never negative: a
   * customization that took money off would let a guest price a drink down.
   */
  priceDeltaCents: number;
};

/**
 * A group is either a radio list (`single`) or a checkbox list (`multi`).
 *
 * `dependsOn` is what lets "Ice" appear only once a guest has asked for the
 * drink iced. A hidden group is not selectable, not required, not priced and
 * not summarised -- see `visibleOptionGroups`.
 */
export type OptionGroup = {
  id: string;
  name: string;
  select: OptionSelect;
  /** Blocks Add to Bag until a choice is made, while the group is visible. */
  required: boolean;
  /** Upper bound for `multi` groups. Always 1 for `single`. */
  maxChoices: number;
  dependsOn?: { groupId: string; choiceIds: readonly string[] };
  choices: readonly OptionChoice[];
};

/** Chosen choice ids, keyed by group id. */
export type OptionSelection = Readonly<Record<string, readonly string[]>>;

function single(
  id: string,
  name: string,
  required: boolean,
  choices: readonly OptionChoice[],
  dependsOn?: OptionGroup['dependsOn'],
): OptionGroup {
  return { id, name, select: 'single', required, maxChoices: 1, choices, dependsOn };
}

function multi(
  id: string,
  name: string,
  maxChoices: number,
  choices: readonly OptionChoice[],
): OptionGroup {
  return { id, name, select: 'multi', required: false, maxChoices, choices };
}

const SERVE = single('serve', 'Serve', true, [
  { id: 'serve-hot', name: 'Hot', priceDeltaCents: 0 },
  { id: 'serve-iced', name: 'Iced', priceDeltaCents: 0 },
]);

const ICE_CHOICES: readonly OptionChoice[] = [
  { id: 'ice-none', name: 'No Ice', priceDeltaCents: 0 },
  { id: 'ice-light', name: 'Light Ice', priceDeltaCents: 0 },
  { id: 'ice-regular', name: 'Regular Ice', priceDeltaCents: 0 },
  { id: 'ice-extra', name: 'Extra Ice', priceDeltaCents: 0 },
];

/** Shown only once the guest has asked for the drink iced. */
const ICE_WHEN_ICED = single('ice', 'Ice', true, ICE_CHOICES, {
  groupId: 'serve',
  choiceIds: ['serve-iced'],
});

/** For drinks that are only ever served cold, so there is nothing to depend on. */
const ICE_ALWAYS = single('ice', 'Ice', true, ICE_CHOICES);

/** Every non-dairy milk is upcharged at the shop's single alt-milk price. */
const ALT_MILK_CENTS = addOnCents('oat-milk');

/**
 * Oat milk lives here rather than in the extras list below, so there is
 * exactly one way to buy it and it cannot be added twice at two prices. Its
 * price is read from the same add-on record the register uses.
 */
const MILK = single('milk', 'Milk', false, [
  { id: 'milk-whole', name: 'Whole Milk', priceDeltaCents: 0 },
  { id: 'milk-skim', name: 'Skim Milk', priceDeltaCents: 0 },
  { id: 'milk-oat', name: 'Oat Milk', priceDeltaCents: ALT_MILK_CENTS },
  { id: 'milk-almond', name: 'Almond Milk', priceDeltaCents: ALT_MILK_CENTS },
]);

const SWEETNESS = single('sweetness', 'Sweetness', false, [
  { id: 'sweet-0', name: 'Unsweetened', priceDeltaCents: 0 },
  { id: 'sweet-50', name: 'Half Sweet', priceDeltaCents: 0 },
  { id: 'sweet-100', name: 'Regular Sweet', priceDeltaCents: 0 },
]);

const PREPARATION = single('preparation', 'Preparation', false, [
  { id: 'prep-toasted', name: 'Toasted', priceDeltaCents: 0 },
  { id: 'prep-untoasted', name: 'Not toasted', priceDeltaCents: 0 },
]);

function addOnCents(slug: string): number {
  const addOn = DEMO_ADD_ONS.find((entry) => entry.slug === slug);
  if (!addOn) throw new Error(`Unknown add-on: ${slug}`);
  return addOn.priceCents;
}

/**
 * Every add-on except oat milk, which the Milk group already sells. Sourced
 * from `DEMO_ADD_ONS` so the register and the app never drift on price.
 */
const EXTRA_CHOICES: readonly OptionChoice[] = DEMO_ADD_ONS
  .filter((addOn) => addOn.slug !== 'oat-milk')
  .map((addOn) => ({
    id: `extra-${addOn.slug}`,
    name: addOn.name,
    priceDeltaCents: addOn.priceCents,
  }));

// The cap is the number of rows, not the number of add-ons. Taking it from
// DEMO_ADD_ONS.length printed "choose up to 4" above three checkboxes, and
// promised a grey-out that could never fire.
const EXTRAS = multi('extras', 'Add-ins', EXTRA_CHOICES.length, EXTRA_CHOICES);

function flavors(id: string, name: string, names: readonly string[]): OptionGroup {
  return single(
    id,
    name,
    true,
    names.map((choice) => ({
      id: `${id}-${choice.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: choice,
      priceDeltaCents: 0,
    })),
  );
}

/**
 * Required choices that the printed menu already asks a guest to make -- the
 * "pistachio, ube, or Nutella" in a menu description is a real decision the
 * barista needs, so it is modelled as a required group rather than left to a
 * free-text note.
 */
const ITEM_FLAVOR_GROUPS: Readonly<Record<string, OptionGroup>> = {
  frappe: flavors('flavor', 'Flavor', ['Biscoff', 'Caramel', 'Strawberry', 'Nutella']),
  'mochi-donut': flavors('flavor', 'Flavor', ['Pistachio', 'Ube', 'Nutella']),
  'milk-cake': flavors('flavor', 'Flavor', ['Pistachio', 'Lotus', 'Saffron']),
  'honeycomb-cheese-bread': flavors('flavor', 'Topping', ['Nutella', 'Biscoff', 'White Chocolate']),
  'toasted-bagel': flavors('flavor', 'Bagel', ['Plain', 'Everything']),
  'loose-leaf-tea': flavors('flavor', 'Tea', ['Earl Grey', 'English Breakfast', 'Green', 'Mint']),
};

/** Drinks the kitchen only ever serves hot, so no Hot/Iced question is asked. */
const HOT_ONLY_ITEMS: ReadonlySet<string> = new Set([
  'espresso',
  'macchiato',
  'cortado',
  'cappuccino',
  'flat-white',
  'turkish-coffee',
  'libyan-nescafe',
]);

/** Drinks that only exist cold, so Ice is asked unconditionally. */
const COLD_ONLY_ITEMS: ReadonlySet<string> = new Set([
  'cold-brew',
  'frappe',
]);

/** Blended, so there is no ice level to choose. */
const BLENDED_ITEMS: ReadonlySet<string> = new Set([
  'smoothie-strawberry-banana',
  'smoothie-mango-banana',
  'smoothie-strawberry-mango',
  'smoothie-green-machine',
  'smoothie-banana-date',
]);

/** Espresso-forward drinks with no milk to choose. */
const NO_MILK_ITEMS: ReadonlySet<string> = new Set([
  'espresso',
  'americano',
  'turkish-coffee',
  'cold-brew',
  'loose-leaf-tea',
]);

const DRINK_CATEGORIES: ReadonlySet<MenuCategoryId> = new Set<MenuCategoryId>([
  'coffee',
  'signature',
  'tea-matcha',
  'boba',
  'ades-smoothies',
]);

export function isDrinkCategory(category: MenuCategoryId): boolean {
  return DRINK_CATEGORIES.has(category);
}

/**
 * The full group list for one menu item, in the order the detail screen
 * renders it: the required decisions first, then the optional ones.
 */
export function optionGroupsFor(itemId: string, category: MenuCategoryId): OptionGroup[] {
  const groups: OptionGroup[] = [];
  const flavor = ITEM_FLAVOR_GROUPS[itemId];
  if (flavor) groups.push(flavor);

  if (isDrinkCategory(category)) {
    const blended = BLENDED_ITEMS.has(itemId);
    const coldOnly = COLD_ONLY_ITEMS.has(itemId) || category === 'boba' || category === 'ades-smoothies';
    const hotOnly = HOT_ONLY_ITEMS.has(itemId);
    if (!hotOnly && !coldOnly && !blended) groups.push(SERVE, ICE_WHEN_ICED);
    else if (coldOnly && !blended) groups.push(ICE_ALWAYS);

    if (!NO_MILK_ITEMS.has(itemId)) groups.push(MILK);
    groups.push(SWEETNESS, EXTRAS);
    return groups;
  }

  if (category === 'sandwiches') groups.push(PREPARATION);
  return groups;
}

/** A group is only in play when its dependency is satisfied by the selection. */
export function isGroupVisible(group: OptionGroup, selection: OptionSelection): boolean {
  const dependency = group.dependsOn;
  if (!dependency) return true;
  const chosen = selection[dependency.groupId] ?? [];
  return chosen.some((id) => dependency.choiceIds.includes(id));
}

export function visibleOptionGroups(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionGroup[] {
  return groups.filter((group) => isGroupVisible(group, selection));
}

/**
 * Applies a tap on one choice.
 *
 * A `single` group replaces its selection; tapping the chosen row again in a
 * required group keeps it, because a required group with nothing chosen is a
 * dead end the guest cannot leave. An optional single group clears instead, so
 * "Whole Milk" can be un-picked. A `multi` group toggles up to `maxChoices`.
 */
export function toggleOptionChoice(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
  groupId: string,
  choiceId: string,
): OptionSelection {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group || !group.choices.some((choice) => choice.id === choiceId)) return selection;
  const current = selection[groupId] ?? [];

  if (group.select === 'single') {
    const next = current.includes(choiceId) && !group.required ? [] : [choiceId];
    return pruneHiddenGroups(groups, { ...selection, [groupId]: next });
  }

  const next = current.includes(choiceId)
    ? current.filter((id) => id !== choiceId)
    : current.length >= group.maxChoices
      ? current
      : [...current, choiceId];
  return pruneHiddenGroups(groups, { ...selection, [groupId]: next });
}

/**
 * Drops selections belonging to groups the current selection has hidden.
 *
 * Without this, switching a drink from Iced to Hot left the ice level chosen
 * and still in the summary: the bag read "Hot · Extra Ice" and the barista
 * got a contradiction.
 */
export function pruneHiddenGroups(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionSelection {
  const next: Record<string, readonly string[]> = {};
  for (const group of groups) {
    if (!isGroupVisible(group, selection)) continue;
    const chosen = selection[group.id];
    if (chosen && chosen.length > 0) next[group.id] = chosen;
  }
  return next;
}

/** Pre-selects the first choice of every visible required group. */
export function defaultOptionSelection(groups: readonly OptionGroup[]): OptionSelection {
  let selection: OptionSelection = {};
  for (const group of groups) {
    if (!group.required || !isGroupVisible(group, selection)) continue;
    const first = group.choices[0];
    if (first) selection = { ...selection, [group.id]: [first.id] };
  }
  return selection;
}

/** Required, visible groups that still have nothing chosen. */
export function missingRequiredGroups(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionGroup[] {
  return visibleOptionGroups(groups, selection).filter(
    (group) => group.required && (selection[group.id] ?? []).length === 0,
  );
}

/** The chosen choices, in group order, ignoring anything hidden or unknown. */
export function selectedChoices(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): OptionChoice[] {
  return visibleOptionGroups(groups, selection).flatMap((group) => {
    const chosen = selection[group.id] ?? [];
    return group.choices.filter((choice) => chosen.includes(choice.id));
  });
}

export function optionDeltaCents(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): number {
  return selectedChoices(groups, selection).reduce(
    (total, choice) => total + Math.max(0, choice.priceDeltaCents),
    0,
  );
}

/**
 * A stable fingerprint for one configuration.
 *
 * Sorted, so the same drink configured in a different tap order merges with
 * the line already in the bag instead of adding a second one.
 */
export function optionFingerprint(
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): string {
  const ids = selectedChoices(groups, selection).map((choice) => choice.id);
  return [...ids].sort().join('+') || 'plain';
}
