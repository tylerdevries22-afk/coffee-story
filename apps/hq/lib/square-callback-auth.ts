import { canManageLocation, type TenantClaims } from '@platform/schema';

import { decodeOAuthState } from './square-oauth-state';

/**
 * May this callback repoint a location's Square connection?
 *
 * The decision is pulled out of the route because that is where it went wrong:
 * the route verified the state format the *previous* version of this flow
 * minted — `<location_id>.<mac>`, no user, no expiry — and kept doing so after
 * the state was hardened. Every legacy state stayed valid forever, and every
 * new one failed. A route is hard to test; this is not.
 *
 * Three things have to hold, and a state only proves the first:
 *  - the state is one we signed, for this location, and has not expired;
 *  - the browser finishing consent belongs to the account that started it;
 *  - that account still manages the location, and the location still belongs
 *    to the brand their claims name. Service role reads past RLS after this,
 *    so nothing downstream re-checks it.
 */
export type CallbackRefusal =
  | 'invalid_state'
  | 'not_signed_in'
  | 'different_account'
  | 'not_your_location';

export type CallbackDecision =
  | { ok: true; locationId: string }
  | { ok: false; reason: CallbackRefusal };

export function authorizeSquareCallback(input: {
  secret: string;
  state: string;
  nowSeconds: number;
  /** null when the console has no session cookie for this browser. */
  sessionUserId: string | null;
  /** Claims decoded from the verified access token, not from the user row. */
  claims: TenantClaims | null;
  /** brand_id on the location row, or null when there is no such location. */
  locationBrandId: string | null;
}): CallbackDecision {
  const decoded = decodeOAuthState(input.secret, input.state, input.nowSeconds);
  if (!decoded.ok) return { ok: false, reason: 'invalid_state' };
  const { locationId, userId } = decoded.state;

  if (!input.sessionUserId) return { ok: false, reason: 'not_signed_in' };
  if (input.sessionUserId !== userId) return { ok: false, reason: 'different_account' };

  const claims = input.claims;
  if (!claims?.role || !canManageLocation(claims, locationId)) {
    return { ok: false, reason: 'not_your_location' };
  }
  if (!input.locationBrandId || input.locationBrandId !== claims.brand_id) {
    return { ok: false, reason: 'not_your_location' };
  }
  return { ok: true, locationId };
}

/**
 * What to tell the caller. The refusals a stranger can reach are deliberately
 * one message: a legacy state, a forged one and a stale one are all "start
 * again", and none of them confirms that a location id exists.
 */
export function refusalResponse(reason: CallbackRefusal): { status: number; body: string } {
  switch (reason) {
    case 'invalid_state':
      return { status: 400, body: 'This connection link is no longer valid. Start again from Locations.' };
    case 'different_account':
      return { status: 403, body: 'This connection was started by a different account.' };
    default:
      return { status: 403, body: 'That location is not yours to connect.' };
  }
}
