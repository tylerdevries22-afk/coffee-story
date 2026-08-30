import type { PrepBoardEntry } from '@platform/data';
import type { PrepStatus } from '@platform/schema';

import type { RecipeStep } from '@/features/prep/bake-list';

function demoBatch(input: {
  id: string;
  itemName: string;
  targetQty: number;
  producedQty?: number;
  status: PrepStatus;
  allergens: string[];
  yieldQty: number;
  yieldUnit: string;
  steps: RecipeStep[];
}): PrepBoardEntry {
  return {
    id: input.id,
    brand_id: 'demo-brand',
    location_id: 'loc-uptown',
    recipe_id: `recipe-${input.id}`,
    service_date: 'demo',
    target_qty: input.targetQty,
    produced_qty: input.producedQty ?? 0,
    status: input.status,
    assigned_to: null,
    started_at: input.status === 'in_progress' ? new Date().toISOString() : null,
    completed_at: input.status === 'done' ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    itemName: input.itemName,
    recipe: {
      id: `recipe-${input.id}`,
      menu_item_id: `item-${input.id}`,
      version: 1,
      steps: input.steps,
      yield_qty: input.yieldQty,
      yield_unit: input.yieldUnit,
      allergens: input.allergens,
    },
  };
}

export const DEMO_BAKE_LIST: readonly PrepBoardEntry[] = [
  demoBatch({
    id: 'batch-1', itemName: 'Pistachio Milk Cake', targetQty: 24,
    status: 'in_progress', allergens: ['nuts', 'dairy', 'eggs'], yieldQty: 12,
    yieldUnit: 'slices', steps: [
      { n: 1, text: 'Whisk the sponge base until it ribbons', quantity: 250, unit: 'g', minutes: 6 },
      { n: 2, text: 'Fold in pistachio paste', quantity: 90, unit: 'g' },
      { n: 3, text: 'Bake at 175°C', minutes: 28 },
      { n: 4, text: 'Soak with the three-milk mix while still warm', quantity: 400, unit: 'ml' },
      { n: 5, text: 'Chill before cutting', minutes: 120 },
    ],
  }),
  demoBatch({
    id: 'batch-2', itemName: 'Honeycomb Cheese Bread', targetQty: 16,
    status: 'pending', allergens: ['dairy', 'gluten'], yieldQty: 8,
    yieldUnit: 'loaves', steps: [
      { n: 1, text: 'Proof the dough', minutes: 45 },
      { n: 2, text: 'Fold in the cheese blend', quantity: 200, unit: 'g' },
      { n: 3, text: 'Bake at 190°C', minutes: 22 },
    ],
  }),
  demoBatch({
    id: 'batch-3', itemName: 'Mochi Donuts', targetQty: 12,
    status: 'pending', allergens: ['dairy'], yieldQty: 12,
    yieldUnit: 'donuts', steps: [
      { n: 1, text: 'Mix glutinous rice flour with milk', quantity: 180, unit: 'g' },
      { n: 2, text: 'Pipe rings and rest', minutes: 15 },
      { n: 3, text: 'Fry at 165°C, turning once', minutes: 4 },
    ],
  }),
  demoBatch({
    id: 'batch-4', itemName: 'Lotus Milk Cake', targetQty: 12, producedQty: 12,
    status: 'done', allergens: ['dairy', 'gluten'], yieldQty: 12,
    yieldUnit: 'slices', steps: [
      { n: 1, text: 'Whisk the sponge base', quantity: 250, unit: 'g', minutes: 6 },
      { n: 2, text: 'Soak and finish with lotus spread', quantity: 120, unit: 'g' },
    ],
  }),
];
