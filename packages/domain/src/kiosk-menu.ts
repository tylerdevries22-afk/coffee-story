/**
 * The kiosk's menu, mapped from live rows.
 *
 * The kiosk shipped a compiled catalog: a tenant could not change a price, add
 * an item or 86 something without a rebuild and a store release. That is the
 * whole franchise story on this surface, so the menu has to come from the
 * database like every other surface's does.
 *
 * This module is the mapping, kept framework-free so `node:test` reaches it
 * without a renderer and so the read itself stays in `@platform/data` where
 * the other surfaces get theirs. Two shapes meet here and they do not agree:
 *
 *   - `menu_items.sizes` is stored `{ slug, label, price_cents }` -- snake
 *     case, an explicit label, no ounces.
 *   - the kiosk's `CatalogSize` is `{ slug, ounces?, priceCents }` -- camel
 *     case, the label derived from the slug.
 *
 * Reading one as the other is silent: `priceCents` comes back undefined and
 * every live item prices at $0.00, which is a giveaway rather than a crash.
 * So `parseSizes` accepts both spellings and is tested on the seed's literal
 * shape. Size slugs are bare in the database (`'12'`, not `'latte-12'`), which
 * `sizeLabelFor` reads as "Each" -- hence the stored label is carried through
 * rather than re-derived.
 */
import type { DropRow, ItemRotation, MenuCategoryRow, MenuItemRow } from '@platform/schema';

import type { KioskNodeTarget } from './kiosk-flow';
import type { OptionGroup } from './menu-options';
import type { CatalogSize } from './sizes';

export type KioskMenuCategory = { id: string; title: string; tagline: string };

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

function finiteCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

/**
 * Sizes, from either spelling.
 *
 * An item with no sizes is normal -- the seed's pastry carries `sizes: []` --
 * and a screen with no size to price is a dead end, so one size is synthesised
 * from `base_price_cents`. Entries with no usable price are dropped rather
 * than shown at zero: a kiosk that sells something for nothing is worse than
 * a kiosk missing a row.
 */
export function parseSizes(raw: unknown, basePriceCents: number): CatalogSize[] {
  const base = finiteCents(basePriceCents) ?? 0;
  const rows = Array.isArray(raw) ? raw : [];
  const sizes: CatalogSize[] = [];
  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    if (slug === '') continue;
    const priceCents = finiteCents(record.priceCents) ?? finiteCents(record.price_cents);
    if (priceCents === null) continue;
    const label = typeof record.label === 'string' && record.label.trim() !== ''
      ? record.label.trim()
      : undefined;
    // Ounces are not stored. A bare numeric slug is the volume, which is what
    // the seed writes and what the label reads back as.
    const numeric = /^(\d+)$/.exec(slug);
    const ounces = finiteCents(record.ounces) ?? (numeric ? Number(numeric[1]) : null);
    sizes.push({
      slug,
      priceCents,
      ...(ounces !== null ? { ounces } : {}),
      ...(label ? { label } : {}),
    });
  }
  if (sizes.length > 0) return sizes;
  return base > 0 ? [{ slug: 'each', priceCents: base, synthetic: true }] : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Reads the exact JSONB option-group contract used by server-side pricing.
 *
 * `null` means the row is malformed, while `[]` is a valid item with no
 * customizations. Keeping those cases distinct lets the live mapper omit an
 * unsafe item instead of silently selling it without a required modifier.
 */
export function parseOptionGroups(raw: unknown): OptionGroup[] | null {
  if (!Array.isArray(raw)) return null;

  const groups: OptionGroup[] = [];
  const groupIds = new Set<string>();
  const choiceIds = new Set<string>();
  for (const entry of raw) {
    const source = record(entry);
    if (!source || !nonEmpty(source.id) || !nonEmpty(source.name)
      || (source.select !== 'single' && source.select !== 'multi')
      || typeof source.required !== 'boolean'
      || !Number.isInteger(source.maxChoices) || Number(source.maxChoices) < 1
      || (source.select === 'single' && source.maxChoices !== 1)
      || !Array.isArray(source.choices) || source.choices.length === 0
      || groupIds.has(source.id)) return null;

    const choices: OptionGroup['choices'][number][] = [];
    for (const entryChoice of source.choices) {
      const choice = record(entryChoice);
      if (!choice || !nonEmpty(choice.id) || !nonEmpty(choice.name)
        || !Number.isInteger(choice.priceDeltaCents) || Number(choice.priceDeltaCents) < 0
        || choiceIds.has(choice.id)) return null;
      choiceIds.add(choice.id);
      choices.push({
        id: choice.id,
        name: choice.name,
        priceDeltaCents: Number(choice.priceDeltaCents),
      });
    }

    groupIds.add(source.id);
    const dependency = source.dependsOn === undefined
      ? undefined
      : parseOptionDependency(source.dependsOn);
    if (source.dependsOn !== undefined && dependency === null) return null;
    groups.push({
      id: source.id,
      name: source.name,
      select: source.select,
      required: source.required,
      maxChoices: Number(source.maxChoices),
      choices,
      ...(dependency ? { dependsOn: dependency } : {}),
    });
  }

  for (const group of groups) {
    const dependency = group.dependsOn;
    if (!dependency) continue;
    const parent = groups.find((candidate) => candidate.id === dependency.groupId);
    if (!parent || parent.id === group.id
      || dependency.choiceIds.some((choiceId) => (
        !parent.choices.some((choice) => choice.id === choiceId)
      ))) return null;
  }
  return groups;
}

function parseOptionDependency(value: unknown): OptionGroup['dependsOn'] | null {
  const source = record(value);
  if (!source || !nonEmpty(source.groupId) || !Array.isArray(source.choiceIds)
    || source.choiceIds.length === 0 || source.choiceIds.some((id) => !nonEmpty(id))) return null;
  return { groupId: source.groupId, choiceIds: source.choiceIds as string[] };
}

export type MenuRows = {
  categories: readonly MenuCategoryRow[];
  items: readonly MenuItemRow[];
  drops: readonly DropRow[];
};

/**
 * Live rows to the kiosk's menu.
 *
 * `single_item_id` is a uuid pointing at another row; it is resolved to that
 * row's slug here, because everything downstream -- the saving badge, the
 * option catalogue -- speaks slugs. A pack whose single was delisted resolves
 * to nothing and simply loses its badge.
 */
export function kioskMenuFromRows(rows: MenuRows): KioskMenu {
  const titleById = new Map(rows.categories.map((c) => [c.id, c.title]));
  const slugById = new Map(rows.items.map((i) => [i.id, i.slug]));
  const items: KioskMenuItem[] = [];
  for (const row of rows.items) {
    const categoryId = titleById.get(row.category_id);
    // An item whose category did not come back has nowhere to be drawn.
    if (categoryId === undefined) continue;
    if (!row.is_listed) continue;
    // Server-side pricing rejects a malformed modifier contract. Omitting the
    // same row here prevents the kiosk from presenting a path that can only
    // fail after payment begins, or from bypassing a required choice.
    const optionGroups = parseOptionGroups(row.modifiers);
    if (optionGroups === null) continue;
    const single = row.single_item_id === null ? undefined : slugById.get(row.single_item_id);
    items.push({
      id: row.slug,
      name: row.name,
      description: row.description,
      categoryId,
      sizes: parseSizes(row.sizes, row.base_price_cents),
      optionGroups,
      soldOutToday: row.is_86d,
      rotation: row.rotation,
      ...(row.image_url ? { imageUrl: row.image_url } : {}),
      ...(typeof row.pack_size === 'number' && row.pack_size > 0
        ? { packSize: row.pack_size }
        : {}),
      ...(row.choice_source ? { choiceSource: row.choice_source } : {}),
      ...(single ? { singleItemId: single } : {}),
      ...(row.pack_choice_slugs.length > 0 ? { eligibleItemIds: [...row.pack_choice_slugs] } : {}),
    });
  }
  const drops: KioskMenuDrop[] = [];
  for (const drop of rows.drops) {
    const itemId = slugById.get(drop.item_id);
    if (itemId === undefined) continue;
    const startsAt = Date.parse(drop.starts_at);
    const endsAt = Date.parse(drop.ends_at);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) continue;
    const revealAt = drop.reveal_at === null ? null : Date.parse(drop.reveal_at);
    drops.push({
      itemId,
      status: drop.status,
      revealAt: revealAt !== null && Number.isFinite(revealAt) ? revealAt : null,
      startsAt,
      endsAt,
    });
  }
  const categories = rows.categories.map((c) => ({
    id: c.title,
    title: c.title,
    tagline: c.tagline,
  }));
  return { categories, items, drops };
}

/** What the flow resolver needs to know, from a menu of any provenance. */
export function menuFactsFrom(menu: KioskMenu): {
  categories: readonly { id: string; title: string }[];
  itemSlugs: readonly string[];
} {
  return {
    categories: menu.categories.map((c) => ({ id: c.id, title: c.title })),
    itemSlugs: menu.items.map((i) => i.id),
  };
}

/** The items under one category title, in menu order. */
export function itemsInCategoryOf(menu: KioskMenu, title: string): readonly KioskMenuItem[] {
  return menu.items.filter((item) => item.categoryId === title);
}

/** Items represented by an entry target, including a direct item tile. */
export function itemsForTarget(
  menu: KioskMenu,
  target: KioskNodeTarget | null | undefined,
): readonly KioskMenuItem[] {
  if (target?.kind === 'category') return itemsInCategoryOf(menu, target.categoryId);
  if (target?.kind === 'item') return menu.items.filter((item) => item.id === target.itemSlug);
  return [];
}

/** Whether choosing this item still requires a size/modifier screen. */
export function itemNeedsConfiguration(
  item: Pick<KioskMenuItem, 'sizes' | 'optionGroups'>,
): boolean {
  return item.sizes.length > 1 || item.optionGroups.length > 0;
}

/** The containers under one category title. */
export function packsInCategoryOf(menu: KioskMenu, title: string): readonly KioskMenuItem[] {
  return itemsInCategoryOf(menu, title).filter((item) => item.packSize !== undefined);
}

/**
 * What may go in this pack right now: the client mirror of `app.pack_choices`
 * (0029).
 *
 * The compiled version took a `pack` argument and ignored it, so a 'lineup'
 * pack and a 'static' pack offered the same list and this week's rotation
 * never narrowed anything -- the one behaviour the column exists to express.
 * With live rows the drop window is readable, so the argument is honoured:
 * 'static' offers every single, 'lineup' offers the permanent ones plus
 * whatever is in an orderable drop.
 *
 * 86'd items are excluded here, which is what makes a prep station's "batch
 * done" reach an open configurator: clearing `is_86d` replicates, the menu
 * re-maps, and the item returns to this list.
 */
export function packChoicesOf(
  menu: KioskMenu,
  pack: Pick<KioskMenuItem, 'packSize' | 'choiceSource' | 'eligibleItemIds'>,
  atMs: number,
): readonly KioskMenuItem[] {
  const orderable = new Set(
    menu.drops
      .filter((drop) => dropVisibility(drop, atMs) === 'orderable')
      .map((drop) => drop.itemId),
  );
  const eligible = new Set(pack.eligibleItemIds ?? []);
  return menu.items.filter((item) => {
    if (!eligible.has(item.id)) return false;
    if (item.packSize !== undefined) return false;
    if (item.soldOutToday) return false;
    if (pack.choiceSource === 'static') return true;
    return item.rotation === 'permanent' || orderable.has(item.id);
  });
}

/** Earliest clock-only transition that can change a lineup pack's choices. */
export function nextPackChoiceBoundary(
  menu: KioskMenu,
  pack: Pick<KioskMenuItem, 'choiceSource' | 'eligibleItemIds'>,
  atMs: number,
): number | null {
  if (pack.choiceSource !== 'lineup') return null;
  const eligible = new Set(pack.eligibleItemIds ?? []);
  let next: number | null = null;
  for (const drop of menu.drops) {
    if (!eligible.has(drop.itemId)) continue;
    if (drop.status === 'draft' || drop.status === 'cancelled') continue;
    for (const boundary of [drop.startsAt, drop.endsAt]) {
      if (boundary > atMs && (next === null || boundary < next)) next = boundary;
    }
  }
  return next;
}
