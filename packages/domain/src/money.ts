/**
 * Money formatting, shared by every surface that prints a price.
 *
 * This used to live in `features/staff/workspace.ts`, which meant the client
 * menu either imported from the staff namespace or grew a second formatter
 * that rounded differently. `workspace.ts` now re-exports from here, so the
 * register and the menu cannot drift.
 *
 * Amounts are integer cents everywhere. Nothing in this module accepts or
 * returns dollars.
 */

/** `$185`, `$185.50`, `$0.75` — cents are dropped only when there are none. */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/**
 * The `+$0.75` shown against a paid customization. A free choice formats to
 * an empty string, so a caller can render it unconditionally.
 */
export function formatPriceDelta(cents: number): string {
  return cents > 0 ? `+${formatMoney(cents)}` : '';
}

/** `2.90%` — the rate beside a tax row. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}
