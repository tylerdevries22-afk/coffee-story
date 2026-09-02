/**
 * Pack contents for the lines being placed: fetch the candidate choices once,
 * then validate each line's selection against listing, 86 and drop windows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { dropVisibility } from '@platform/domain';

import {
  PackOrderError,
  validatePackSelection,
  type PackChoiceAvailability,
  type ResolvedPackContent,
} from '../pack-order';

import type { OrderMenuItem } from './internal';
import { OrderError, type CreateOrderLine } from './types';

const MAX_PACK_CONTENT_ENTRIES = 500;

type PackChoiceRow = Pick<OrderMenuItem, 'id' | 'slug' | 'name' | 'pack_size'> & {
  is_listed: boolean;
  is_86d: boolean;
  rotation: PackChoiceAvailability['rotation'];
};

type PackDropRow = {
  item_id: string;
  status: 'draft' | 'scheduled' | 'revealed' | 'live' | 'ended' | 'cancelled';
  reveal_at: string | null;
  starts_at: string;
  ends_at: string;
};

export async function packContentsForLines(
  db: SupabaseClient,
  brandId: string,
  menuId: string,
  lines: readonly CreateOrderLine[],
  items: ReadonlyMap<string, OrderMenuItem>,
): Promise<ResolvedPackContent[][]> {
  const entryCount = lines.reduce((total, line) => total + (line.packContents?.length ?? 0), 0);
  if (entryCount > MAX_PACK_CONTENT_ENTRIES) {
    throw new OrderError('invalid_request', `An order may carry at most ${MAX_PACK_CONTENT_ENTRIES} pack entries.`);
  }
  const contentSlugs = [...new Set(lines.flatMap((line) => line.packContents?.map((entry) => entry.itemSlug) ?? []))];
  const choices = contentSlugs.length === 0
    ? []
    : await fetchPackChoices(db, brandId, menuId, contentSlugs);
  const orderableDropIds = await fetchOrderableDropIds(db, brandId, choices);
  const availability = choices.map<PackChoiceAvailability>((choice) => ({
    itemSlug: choice.slug,
    name: choice.name,
    isListed: choice.is_listed,
    is86d: choice.is_86d,
    packSize: choice.pack_size,
    rotation: choice.rotation,
    dropOrderable: orderableDropIds.has(choice.id),
  }));
  return lines.map((line) => {
    const item = items.get(line.itemSlug);
    if (!item) throw new OrderError('item_unavailable', `"${line.itemSlug}" is not available right now.`);
    try {
      return validatePackSelection({
        packSize: item.pack_size,
        choiceSource: item.choice_source,
        eligibleItemSlugs: item.pack_choice_slugs,
      }, line.packContents, availability);
    } catch (error) {
      if (error instanceof PackOrderError) throw new OrderError(error.code, error.message);
      throw error;
    }
  });
}

async function fetchPackChoices(
  db: SupabaseClient,
  brandId: string,
  menuId: string,
  slugs: readonly string[],
): Promise<PackChoiceRow[]> {
  const result = await db.from('menu_items')
    .select('id, slug, name, pack_size, is_listed, is_86d, rotation')
    .eq('brand_id', brandId)
    .eq('menu_id', menuId)
    .in('slug', [...slugs])
    .returns<PackChoiceRow[]>();
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function fetchOrderableDropIds(
  db: SupabaseClient,
  brandId: string,
  choices: readonly PackChoiceRow[],
): Promise<ReadonlySet<string>> {
  const rotatingIds = choices.filter((choice) => choice.rotation !== 'permanent').map((choice) => choice.id);
  if (rotatingIds.length === 0) return new Set();
  const result = await db.from('drops')
    .select('item_id, status, reveal_at, starts_at, ends_at')
    .eq('brand_id', brandId)
    .in('item_id', rotatingIds)
    .returns<PackDropRow[]>();
  if (result.error) throw result.error;
  const now = Date.now();
  return new Set((result.data ?? []).filter((drop) => dropVisibility({
    itemId: drop.item_id,
    status: drop.status,
    revealAt: drop.reveal_at === null ? null : Date.parse(drop.reveal_at),
    startsAt: Date.parse(drop.starts_at),
    endsAt: Date.parse(drop.ends_at),
  }, now) === 'orderable').map((drop) => drop.item_id));
}
