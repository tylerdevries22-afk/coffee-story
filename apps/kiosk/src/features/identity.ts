/**
 * Identifying a guest at a lobby kiosk.
 *
 * Two rules shape everything here, both from `docs/research/PRODUCT-MECHANICS.md`
 * and from the fact that this screen stands unattended in a room:
 *
 * 1. Identifying is OPTIONAL and must never block an anonymous purchase. A
 *    guest who cannot remember their number still gets their coffee.
 * 2. The raw number is never kept. It is used to look up, and what survives is
 *    a mask -- `posture.unattended` is true here, and the next guest walks up
 *    to whatever the last one left on screen.
 *
 * Pure, so the formatting and the masking are tested without a renderer.
 */

/** North American, because that is what the platform's shops are. */
const NATIONAL_DIGITS = 10;

/** Digits only, capped. A keypad cannot emit anything else, but paste can. */
export function digitsOf(input: string): string {
  return input.replace(/\D/g, '').slice(0, NATIONAL_DIGITS);
}

/** `(720) 609-2971`, formatted as it is typed rather than on submit. */
export function formatPhone(input: string): string {
  const digits = digitsOf(input);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isCompletePhone(input: string): boolean {
  return digitsOf(input).length === NATIONAL_DIGITS;
}

/**
 * What may stay on screen after a lookup.
 *
 * Last four only. A lobby kiosk shows this to whoever is next in the queue, so
 * the mask is the thing that is displayed and the raw number is discarded --
 * enough for the guest to recognise their own account, not enough to be
 * somebody else's.
 */
export function maskPhone(input: string): string | null {
  const digits = digitsOf(input);
  if (digits.length !== NATIONAL_DIGITS) return null;
  return `••• ••• ${digits.slice(6)}`;
}

/** A first name is display-safe on a shared screen; a full record is not. */
export function displayName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first;
}
