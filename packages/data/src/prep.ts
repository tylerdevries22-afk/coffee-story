import type { SupabaseClient } from '@supabase/supabase-js';

import type { PrepBatchRow, RecipeRow } from '@platform/schema';

export type PrepBoardEntry = PrepBatchRow & {
  recipe: Pick<RecipeRow, 'id' | 'menu_item_id' | 'version' | 'steps' | 'yield_qty' | 'yield_unit' | 'allergens'>;
  itemName: string;
};

/**
 * The bench's bake list for one day.
 *
 * Joins the recipe and the item name in one round trip: a station on a shop's
 * wifi should not make three requests to draw a list, and it has no business
 * holding a menu client of its own.
 */
export async function fetchPrepBoard(
  client: SupabaseClient,
  locationId: string,
  serviceDate: string,
): Promise<PrepBoardEntry[]> {
  const result = await client
    .from('prep_batches')
    .select('*, recipe:recipes(id, menu_item_id, version, steps, yield_qty, yield_unit, allergens, menu_items(name))')
    .eq('location_id', locationId)
    .eq('service_date', serviceDate)
    .order('status')
    .returns<(PrepBatchRow & { recipe: PrepBoardEntry['recipe'] & { menu_items?: { name?: string } } })[]>();
  if (result.error) throw new Error(`fetchPrepBoard: ${result.error.message}`);
  return (result.data ?? []).map((row) => ({
    ...row,
    recipe: row.recipe,
    itemName: row.recipe?.menu_items?.name ?? 'Unnamed item',
  }));
}

/** Applies a Realtime batch row without discarding its joined recipe metadata. */
export function mergePrepBoardEntry(
  entries: readonly PrepBoardEntry[],
  row: PrepBatchRow,
): PrepBoardEntry[] {
  const index = entries.findIndex((entry) => entry.id === row.id);
  if (index < 0) return [...entries];
  const next = [...entries];
  next[index] = { ...next[index]!, ...row };
  return next;
}

/**
 * The recipe version a batch was actually made from.
 *
 * Takes the batch's recipe_id rather than looking up the item's latest: a tray
 * in the oven was made from what was on screen when it started, and a mid-bake
 * edit must not rewrite the steps under the person following them.
 */
export async function fetchRecipe(
  client: SupabaseClient,
  recipeId: string,
): Promise<RecipeRow | null> {
  const result = await client
    .from('recipes')
    .select('*')
    .eq('id', recipeId)
    .maybeSingle<RecipeRow>();
  if (result.error) throw new Error(`fetchRecipe: ${result.error.message}`);
  return result.data ?? null;
}

/**
 * Scales a recipe's step quantities to a batch's target.
 *
 * Returns the multiplier rather than rewriting the steps, so a station can
 * show "×2" beside the original numbers. A baker doubling a tray wants to see
 * both, and a silently-rewritten quantity is unverifiable against the card.
 */
export function batchScale(recipe: Pick<RecipeRow, 'yield_qty'>, targetQty: number): number {
  if (recipe.yield_qty <= 0) return 1;
  return targetQty / recipe.yield_qty;
}

/** Live bake-list updates: another station finishing a tray, or a new batch. */
export function subscribeToPrepBatches(
  client: SupabaseClient | null,
  locationId: string,
  onChange: () => void,
): () => void {
  if (!client) return () => {};
  const channel = client
    .channel(`prep-${locationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prep_batches', filter: `location_id=eq.${locationId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
