/**
 * The name a guest puts on an order.
 *
 * This lands in `orders.guest_label`, which 0023 describes as "display-safe"
 * and which the pickup board reads. `board_tickets` is granted to `anon`, and
 * the board hangs on a wall the whole room can see -- so this field is a
 * broadcast channel, and the shape of what may enter it is a real decision
 * rather than a formality.
 *
 * Be honest about the limit: a 24-character string can still be made to read
 * as something unwanted. The cap and the character class make it unattractive,
 * not impossible, and the audience is one shop rather than the internet.
 */

export const MAX_GUEST_LABEL = 24;

/**
 * Letters, digits, spaces and the punctuation a name actually contains.
 *
 * Unicode-aware on purpose: `\p{L}` keeps Иван and 李 as valid names. An ASCII
 * class here would refuse a large share of real guests, which is a worse
 * failure than the one it prevents.
 */
const ALLOWED = /^[\p{L}\p{N} .,''-]+$/u;

export type GuestLabelResult =
  /** Nothing was offered. The field is omitted rather than sent empty. */
  | { kind: 'absent' }
  | { kind: 'ok'; label: string }
  | { kind: 'rejected'; reason: 'too-long' | 'unsupported-characters' };

export function parseGuestLabel(value: unknown): GuestLabelResult {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (typeof value !== 'string') return { kind: 'rejected', reason: 'unsupported-characters' };
  // Collapse runs of whitespace: a wall board has one line, and "A          B"
  // is a way of taking more of it than a name should.
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return { kind: 'absent' };
  if (collapsed.length > MAX_GUEST_LABEL) return { kind: 'rejected', reason: 'too-long' };
  if (!ALLOWED.test(collapsed)) return { kind: 'rejected', reason: 'unsupported-characters' };
  return { kind: 'ok', label: collapsed };
}

/** What to send as `guestLabel`, or undefined to omit the field entirely. */
export function guestLabelFor(value: unknown): string | undefined {
  const parsed = parseGuestLabel(value);
  return parsed.kind === 'ok' ? parsed.label : undefined;
}
