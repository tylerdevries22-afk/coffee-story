/**
 * The cart snapshot stored on `orders.totals` and on every `order_events` row.
 *
 * Rule 2 makes this snapshot the historical record: `order_events` is
 * append-only and each transition carries the cart as it stood. That means the
 * shape is a contract between one writer and several readers who are, by
 * design, reading data that may be older than their own code.
 *
 * It was previously modelled in three places that imported nothing from each
 * other -- the engine that writes it, the customer app, and the operator KDS --
 * and the operator's copy simply omitted `unit_price_cents`, which is why the
 * KDS could never show a line price. Every mirror used optional fields with
 * `?? 'Item'` defaults, so a renamed key would not have failed anywhere; it
 * would have quietly rendered "Item x1" forever.
 *
 * So this exports two things, not one:
 *
 * - `OrderSnapshotLine`, the EXACT shape the engine writes, so the write is
 *   type-checked against the contract rather than against itself.
 * - `readSnapshotLines`, the tolerant READ, because a row written by an older
 *   release is a normal thing to encounter and must degrade rather than throw.
 *
 * Sharing the parse rather than only the type is what makes a rename a
 * single-place change with a test behind it.
 */

/** Exactly what the engine writes. Snake case, because it is stored JSON. */
export type OrderSnapshotLine = {
  item_slug: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  options: string[];
  note: string;
};

export type OrderSnapshotTaxRow = {
  id: string;
  label: string;
  rate: number;
  amount_cents: number;
};

export type OrderSnapshot = {
  lines: OrderSnapshotLine[];
  tax_rows: OrderSnapshotTaxRow[];
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  tender_type: string;
};

/** A line as a reader should treat it: every field may be missing or wrong. */
export type ReadSnapshotLine = {
  itemSlug: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  options: string[];
  note: string;
};

const FALLBACK_NAME = 'Item';

/**
 * Reads the lines out of an `orders.totals` value.
 *
 * Never throws and never returns a partial line: a caller rendering a board or
 * a receipt has nowhere to put an error, so a malformed row degrades to
 * something printable instead. A line with no recognisable name is dropped
 * rather than rendered as "Item", because a ticket listing a phantom item is
 * worse than a ticket listing one fewer.
 */
export function readSnapshotLines(totals: unknown): ReadSnapshotLine[] {
  const source = asRecord(totals);
  const raw = source?.lines;
  if (!Array.isArray(raw)) return [];
  const lines: ReadSnapshotLine[] = [];
  for (const candidate of raw) {
    const line = asRecord(candidate);
    if (!line) continue;
    const name = text(line.name) ?? text(line.item_slug);
    if (!name) continue;
    lines.push({
      itemSlug: text(line.item_slug) ?? '',
      name,
      quantity: count(line.quantity, 1),
      unitPriceCents: count(line.unit_price_cents, 0),
      options: Array.isArray(line.options)
        ? line.options.filter((option): option is string => typeof option === 'string')
        : [],
      note: text(line.note) ?? '',
    });
  }
  return lines;
}

/** The printable name for a line, for a caller that only needs that. */
export function snapshotLineLabel(line: ReadSnapshotLine): string {
  return line.name || FALLBACK_NAME;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}
