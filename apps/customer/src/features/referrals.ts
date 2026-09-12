/**
 * Referral codes, demo-side. The engine issues real codes server-side
 * (referrals table, unique per brand); this derives a stable demo code so the
 * screen behaves identically in both modes.
 *
 * The share sentence is deliberately absent: what a referral is worth is the
 * brand's to say -- a tenant who sells renovations gives away no free drink --
 * so it lives in the `referralShare` copy key and is filled by `useCopy` at
 * the one screen that shares it.
 */

/** "Jordan Álvarez" + "CS" -> "CS-JORDAN-7f3a" style, stable per name. */
export function referralCodeFor(fullName: string, prefix: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'FRIEND';
  let hash = 0;
  for (const char of `${prefix}:${fullName}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `${prefix}-${clean}-${(hash % 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
}

/**
 * Neither the incoming-code banner nor the share card may promise an
 * automatic credit: `PlaceOrderRequest` carries no referral field
 * (packages/api-client/src/contract.ts) and no function anywhere in
 * packages/schema or packages/engine completes one on payment -- see
 * tests/consistency/src/referral-capability-preconditions.test.ts. The team
 * applying a code by hand at the register is the only path that is real
 * today, so both messages point there instead of naming software that
 * doesn't exist.
 */
export function referralIncomingMessage(code: string): string {
  return `Show code ${code} to the team when you order -- they can apply your friend's referral at checkout.`;
}

export const REFERRAL_SHARE_EXPLAINER =
  'Share it with a friend. When they mention it at checkout on their first order, the team can apply the reward for both of you.';
