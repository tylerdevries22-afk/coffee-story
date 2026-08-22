/**
 * The bag: configured menu lines, their quantities, and the note that rides
 * with the order.
 *
 * Pure, like `menu-options.ts`, so `node:test` covers the whole money path
 * before a pixel is drawn. Lines carry no image: the bag screen looks the item
 * back up in `data/catalog.ts` by `itemId`, which keeps the asset imports out
 * of this module.
 *
 * Prices are integer cents throughout, matching `features/staff/pos-totals.ts`
 * and every `*Cents` field in `types/domain.ts`. Nothing here ever sees a
 * float dollar amount.
 */
import { formatPriceDelta } from '@/features/money';

import {
  optionDeltaCents,
  optionFingerprint,
  selectedChoices,
  type OptionGroup,
  type OptionSelection,
} from './menu-options';

/** One line cannot exceed this. Beyond it the shop wants a catering order. */
export const MAX_LINE_QUANTITY = 20;

/** Matches the note field's character counter on the note step. */
export const MAX_ORDER_NOTE_LENGTH = 150;

export type OrderLine = {
  /**
   * Item, size and configuration together. Two taps that produce the same
   * drink merge onto one line rather than stacking two identical rows.
   */
  id: string;
  itemId: string;
  name: string;
  sizeSlug: string;
  sizeLabel: string;
  /** The size's list price, before any customization. */
  basePriceCents: number;
  /** Sorted, so the fingerprint in `id` and this list agree. */
  optionIds: readonly string[];
  /** "16 oz · Iced · Regular Ice · Oat Milk (+$0.75)" — what the bag shows. */
  optionSummary: string;
  /** base + option deltas, for a single unit. */
  unitPriceCents: number;
  quantity: number;
};

export type OrderCart = {
  lines: readonly OrderLine[];
  note: string;
};

export const EMPTY_CART: OrderCart = { lines: [], note: '' };

export type OrderLineInput = {
  itemId: string;
  name: string;
  sizeSlug: string;
  sizeLabel: string;
  basePriceCents: number;
  groups: readonly OptionGroup[];
  selection: OptionSelection;
  quantity?: number;
};

/**
 * The summary line under an item in the bag.
 *
 * Only choices that cost something show their price, which is how the
 * reference flow reads: the free decisions are context, the paid ones are
 * receipt.
 */
export function optionSummary(
  sizeLabel: string,
  groups: readonly OptionGroup[],
  selection: OptionSelection,
): string {
  const parts = selectedChoices(groups, selection).map((choice) => (
    choice.priceDeltaCents > 0
      ? `${choice.name} (${formatPriceDelta(choice.priceDeltaCents)})`
      : choice.name
  ));
  return [sizeLabel, ...parts].filter(Boolean).join(' · ');
}

export function buildOrderLine(input: OrderLineInput): OrderLine {
  const choices = selectedChoices(input.groups, input.selection);
  const basePriceCents = Math.max(0, Math.round(input.basePriceCents));
  return {
    id: `${input.sizeSlug}#${optionFingerprint(input.groups, input.selection)}`,
    itemId: input.itemId,
    name: input.name,
    sizeSlug: input.sizeSlug,
    sizeLabel: input.sizeLabel,
    basePriceCents,
    optionIds: [...choices.map((choice) => choice.id)].sort(),
    optionSummary: optionSummary(input.sizeLabel, input.groups, input.selection),
    unitPriceCents: basePriceCents + optionDeltaCents(input.groups, input.selection),
    quantity: clampQuantity(input.quantity ?? 1),
  };
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.round(quantity)));
}

/**
 * How many of `line` the bag can actually take.
 *
 * `addOrderLine` clamps a merged line at `MAX_LINE_QUANTITY`, which means a
 * bag already holding the maximum swallows the next add whole -- the guest
 * taps a button quoting five more drinks and nothing changes. Callers ask
 * first so they can say so.
 */
export function addableQuantity(cart: OrderCart, line: OrderLine): number {
  const existing = cart.lines.find((entry) => entry.id === line.id);
  const room = MAX_LINE_QUANTITY - (existing?.quantity ?? 0);
  return Math.max(0, Math.min(line.quantity, room));
}

/** Adds a configured line, merging into an identical one already in the bag. */
export function addOrderLine(cart: OrderCart, line: OrderLine): OrderCart {
  const existing = cart.lines.find((entry) => entry.id === line.id);
  if (!existing) return { ...cart, lines: [...cart.lines, line] };
  return {
    ...cart,
    lines: cart.lines.map((entry) => (
      entry.id === line.id
        ? { ...entry, quantity: clampQuantity(entry.quantity + line.quantity) }
        : entry
    )),
  };
}

/** Changes a line's quantity, dropping the line once it reaches zero. */
export function changeOrderLineQuantity(cart: OrderCart, id: string, delta: number): OrderCart {
  return {
    ...cart,
    lines: cart.lines.flatMap((line) => {
      if (line.id !== id) return [line];
      const quantity = line.quantity + delta;
      return quantity <= 0 ? [] : [{ ...line, quantity: clampQuantity(quantity) }];
    }),
  };
}

export function removeOrderLine(cart: OrderCart, id: string): OrderCart {
  return { ...cart, lines: cart.lines.filter((line) => line.id !== id) };
}

/** Trimmed and capped at the length the note field advertises. */
export function setOrderNote(cart: OrderCart, note: string): OrderCart {
  return { ...cart, note: note.slice(0, MAX_ORDER_NOTE_LENGTH) };
}

export function clearOrderCart(): OrderCart {
  return { lines: [], note: '' };
}

/** Every unit in the bag — the number on the View Bag badge. */
export function orderItemCount(cart: OrderCart): number {
  return cart.lines.reduce((total, line) => total + line.quantity, 0);
}

export function orderLineTotalCents(line: OrderLine): number {
  return line.unitPriceCents * line.quantity;
}

export function orderSubtotalCents(cart: OrderCart): number {
  return cart.lines.reduce((total, line) => total + orderLineTotalCents(line), 0);
}

export function isCartEmpty(cart: OrderCart): boolean {
  return cart.lines.length === 0;
}
