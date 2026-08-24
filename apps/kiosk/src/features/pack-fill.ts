/**
 * Filling a pack.
 *
 * Migration 0029 records why this is not a modifier group: `menu_items.modifiers`
 * expresses single/multi select with a maximum, and a pack needs three things
 * it cannot say --
 *
 *   1. an EXACT count. "Select 6" stays shut at five.
 *   2. a quantity per choice, so a valid fill is a MULTISET (2 of one, 4 of
 *      another) rather than a set of six distinct things.
 *   3. a choice list that is this week's lineup, which changes without anyone
 *      editing the pack.
 *
 * This module owns the first two. The third is a query (`app.pack_choices`).
 *
 * Pure, so `node:test` reaches all of it.
 */

/** The container being filled. `packSize` is `menu_items.pack_size`. */
export type PackSpec = { packSize: number };

/** choice id -> how many of that choice are in the box. Never zero-valued. */
export type PackFill = Readonly<Record<string, number>>;

export const EMPTY_FILL: PackFill = {};

/** How many units are in the box. */
export function allocated(fill: PackFill): number {
  let total = 0;
  for (const quantity of Object.values(fill)) total += quantity;
  return total;
}

/** Slots still to fill. Never negative, even if a spec shrinks under a fill. */
export function remaining(spec: PackSpec, fill: PackFill): number {
  return Math.max(0, safeSize(spec) - allocated(fill));
}

export function isComplete(spec: PackSpec, fill: PackFill): boolean {
  return safeSize(spec) > 0 && allocated(fill) === safeSize(spec);
}

/**
 * Add one of `choiceId`.
 *
 * A full box is a no-op, deliberately not a clamp-and-swap: a guest tapping a
 * seventh cookie into a six-pack expects nothing to happen, not for one of
 * their earlier choices to be silently replaced.
 */
export function allocate(spec: PackSpec, fill: PackFill, choiceId: string): PackFill {
  if (!choiceId || remaining(spec, fill) <= 0) return fill;
  return { ...fill, [choiceId]: (fill[choiceId] ?? 0) + 1 };
}

/** Remove one of `choiceId`, dropping the key entirely at zero. */
export function release(fill: PackFill, choiceId: string): PackFill {
  const current = fill[choiceId] ?? 0;
  if (current <= 0) return fill;
  const next = { ...fill };
  if (current === 1) delete next[choiceId];
  else next[choiceId] = current - 1;
  return next;
}

/** Set an exact quantity, clamped to what the box can still hold. */
export function setQuantity(
  spec: PackSpec,
  fill: PackFill,
  choiceId: string,
  quantity: number,
): PackFill {
  if (!choiceId || !Number.isFinite(quantity)) return fill;
  const others = allocated(fill) - (fill[choiceId] ?? 0);
  const wanted = Math.max(0, Math.trunc(quantity));
  const capped = Math.min(wanted, Math.max(0, safeSize(spec) - others));
  const next = { ...fill };
  if (capped === 0) delete next[choiceId];
  else next[choiceId] = capped;
  return next;
}

/**
 * A stable identity for a fill, so two boxes with the same contents merge onto
 * one bag line however the guest tapped them in.
 *
 * Sorted, for the same reason `optionFingerprint` sorts: A,B,A and A,A,B are
 * the same box, and a bag that lists them separately is a bag that looks wrong
 * to the person holding it.
 */
export function packFingerprint(fill: PackFill): string {
  return Object.entries(fill)
    .filter(([, quantity]) => quantity > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, quantity]) => `${id}x${quantity}`)
    .join('|');
}

/** The box's contents in reading order, for a bag row or a receipt line. */
export function packSummary(fill: PackFill, nameOf: (choiceId: string) => string): string {
  return Object.entries(fill)
    .filter(([, quantity]) => quantity > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, quantity]) => (quantity === 1 ? nameOf(id) : `${quantity} × ${nameOf(id)}`))
    .join(', ');
}

/**
 * What a pack saves against buying its singles, in basis points.
 *
 * A mirror of `app.pack_saving_bps` (migration 0029) so the shelf can show
 * "Save N%" without a round trip. Two details are load-bearing and are what the
 * test pins:
 *
 * - **Truncation, not rounding.** The SQL divides two integers, and Postgres
 *   integer division truncates. Rounding here would advertise a saving the
 *   database does not agree with.
 * - **Never negative.** A pack priced above its singles reports 0. A shelf
 *   must not advertise a loss as a saving.
 */
export function packSavingBps(
  singlePriceCents: number,
  packPriceCents: number,
  packSize: number,
): number {
  const singles = Math.trunc(singlePriceCents) * Math.trunc(packSize);
  if (!Number.isFinite(singles) || singles <= 0) return 0;
  return Math.max(0, Math.trunc(((singles - Math.trunc(packPriceCents)) * 10000) / singles));
}

function safeSize(spec: PackSpec): number {
  return Number.isFinite(spec.packSize) && spec.packSize > 0 ? Math.trunc(spec.packSize) : 0;
}
