/**
 * Catering has no request intake today. "catering" only exists in
 * packages/engine and packages/schema as a `fulfillmentType` on a normal
 * order (see packages/engine/src/orders/types.ts) -- there is no endpoint,
 * table, or staff notification for a lead-style inquiry (event date, party
 * size, notes). The screen used to collect those fields and flip to a
 * "Request received" state on tap; nothing ever left the device, so the shop
 * never saw it (see platform-pages.tsx history).
 *
 * Until a real intake exists, the honest state points the guest at a channel
 * that actually reaches the shop: calling or emailing directly.
 */
export const CATERING_UNAVAILABLE_MESSAGE =
  "Catering requests aren't handled in the app yet. Call or email the shop directly and they'll follow up with a quote.";

/** Digits and a leading "+" only; a `tel:` link ignores everything else anyway. */
export function cateringPhoneHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

export function cateringEmailHref(email: string, subject = 'Catering request'): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
