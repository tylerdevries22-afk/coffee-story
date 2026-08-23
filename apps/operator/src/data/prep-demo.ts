import type { BakeBatch } from '@/features/prep/bake-list';

/**
 * A morning's baking, for the station to be judged against with no database.
 *
 * Shaped to exercise what the screen has to handle: a tray in the oven, a
 * doubled batch, one already out, and an item with allergens that must be
 * impossible to miss.
 */
export const DEMO_BAKE_LIST: readonly BakeBatch[] = [
  {
    id: 'batch-1',
    itemName: 'Pistachio Milk Cake',
    targetQty: 24,
    producedQty: 0,
    status: 'in_progress',
    allergens: ['nuts', 'dairy', 'eggs'],
    yieldQty: 12,
    yieldUnit: 'slices',
  },
  {
    id: 'batch-2',
    itemName: 'Honeycomb Cheese Bread',
    targetQty: 16,
    producedQty: 0,
    status: 'pending',
    allergens: ['dairy', 'gluten'],
    yieldQty: 8,
    yieldUnit: 'loaves',
  },
  {
    id: 'batch-3',
    itemName: 'Mochi Donuts',
    targetQty: 12,
    producedQty: 0,
    status: 'pending',
    allergens: ['dairy'],
    yieldQty: 12,
    yieldUnit: 'donuts',
  },
  {
    id: 'batch-4',
    itemName: 'Lotus Milk Cake',
    targetQty: 12,
    producedQty: 12,
    status: 'done',
    allergens: ['dairy', 'gluten'],
    yieldQty: 12,
    yieldUnit: 'slices',
  },
];

export type RecipeStep = { n: number; text: string; quantity?: number; unit?: string; minutes?: number };

export const DEMO_RECIPE_STEPS: Readonly<Record<string, readonly RecipeStep[]>> = {
  'batch-1': [
    { n: 1, text: 'Whisk the sponge base until it ribbons', quantity: 250, unit: 'g', minutes: 6 },
    { n: 2, text: 'Fold in pistachio paste', quantity: 90, unit: 'g' },
    { n: 3, text: 'Bake at 175°C', minutes: 28 },
    { n: 4, text: 'Soak with the three-milk mix while still warm', quantity: 400, unit: 'ml' },
    { n: 5, text: 'Chill before cutting', minutes: 120 },
  ],
  'batch-2': [
    { n: 1, text: 'Proof the dough', minutes: 45 },
    { n: 2, text: 'Fold in the cheese blend', quantity: 200, unit: 'g' },
    { n: 3, text: 'Bake at 190°C', minutes: 22 },
  ],
  'batch-3': [
    { n: 1, text: 'Mix glutinous rice flour with milk', quantity: 180, unit: 'g' },
    { n: 2, text: 'Pipe rings and rest', minutes: 15 },
    { n: 3, text: 'Fry at 165°C, turning once', minutes: 4 },
  ],
  'batch-4': [
    { n: 1, text: 'Whisk the sponge base', quantity: 250, unit: 'g', minutes: 6 },
    { n: 2, text: 'Soak and finish with lotus spread', quantity: 120, unit: 'g' },
  ],
};
