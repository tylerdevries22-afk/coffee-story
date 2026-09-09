import type { DropRow, ItemRotation } from '@platform/schema';

import type { OptionGroup } from './menu-options';
import type { CatalogSize } from './sizes';

export type KioskMenuCategory = {
  id: string;
  title: string;
  tagline: string;
  stableId?: string;
  parentStableId?: string | null;
};

/**
 * One item as the kiosk screens consume it.
 *
 * `id` is the SLUG, not the uuid: a uuid differs per environment, and the
 * option catalogue and tenant files both name items by slug. `categoryId` is
 * the category TITLE for the same reason -- `menu_categories` (0003) has no
 * slug column, so the title is the only stable name a tenant file can use.
 * `kiosk-flow.ts` keys entry nodes the same way.
 */
export type KioskMenuItem = {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  sizes: readonly CatalogSize[];
  /** Tenant-authored choices, in the same shape the pricing service validates. */
  optionGroups: readonly OptionGroup[];
  soldOutToday: boolean;
  rotation: ItemRotation;
  imageUrl?: string;
  /** Null in the row means this is not a pack; absent here means the same. */
  packSize?: number;
  choiceSource?: 'lineup' | 'static';
  /** The single this pack is built from, as a slug. */
  singleItemId?: string;
  /** Explicit authored slugs this pack may contain, before live availability. */
  eligibleItemIds?: readonly string[];
};

/** A drop, reduced to what visibility needs and keyed by item slug. */
export type KioskMenuDrop = {
  itemId: string;
  status: DropRow['status'];
  revealAt: number | null;
  startsAt: number;
  endsAt: number;
};

export type KioskMenu = {
  categories: readonly KioskMenuCategory[];
  items: readonly KioskMenuItem[];
  drops: readonly KioskMenuDrop[];
};

export const EMPTY_KIOSK_MENU: KioskMenu = { categories: [], items: [], drops: [] };

export type DropVisibility = 'hidden' | 'revealed' | 'orderable' | 'ended';

/**
 * The client mirror of `app.drop_visibility` (0026).
 *
 * That function's own comment says it is kept in SQL because three clients ask
 * the same question and a disagreement between them is the bug it prevents --
 * so this is a mirror under test against the same branches, not a second
 * opinion. The server stays the authority; this decides what a screen draws
 * between reads.
 */
export function dropVisibility(drop: KioskMenuDrop, atMs: number): DropVisibility {
  if (drop.status === 'draft' || drop.status === 'cancelled') return 'hidden';
  if (atMs >= drop.startsAt && atMs < drop.endsAt) return 'orderable';
  if (atMs >= drop.endsAt) return 'ended';
  if (drop.revealAt !== null && atMs >= drop.revealAt) return 'revealed';
  return 'hidden';
}
