/**
 * One shop's menu vocabulary, kept as a fixture rather than as shared code.
 *
 * This lived in `menu-options.ts` and was exported from the package, which
 * made the first tenant's seven categories and its item slugs -- `latte`,
 * `turkish-coffee`, `mochi-donut` -- part of the platform's own type surface.
 * A bakery's categories would not have typechecked against it.
 *
 * Nothing in production ever called it. Every surface builds its groups from
 * the tenant's own menu (`item.optionGroups`, written by
 * `pnpm onboard --apply` from that tenant's modifiers file); a comparison of
 * all 61 items in the launch tenant's bundled menu found every group this
 * module generates already present in that data, so the shop it describes is
 * fully represented by the tenant's own config.
 *
 * It stays because the option-model tests are worth running against a real
 * menu rather than a toy one -- a `latte` with Serve/Ice/Milk/Sweetness/Add-ins
 * exercises the dependency and pruning rules the way a shop does. It is a
 * fixture, so it is not exported from the package index and no shipped code
 * may import it.
 */
import { DEMO_ADD_ONS } from './add-ons';
import type { OptionChoice, OptionGroup } from './menu-options';

/**
 * The menu's category vocabulary, as this one shop writes it.
 *
 * A tenant's categories come from its own `menu-categories.json`; the apps
 * type them as plain strings. This union describes the fixture only.
 */
export type MenuCategoryId =
  | 'coffee' | 'signature' | 'tea-matcha' | 'boba'
  | 'ades-smoothies' | 'sandwiches' | 'sweets';

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
