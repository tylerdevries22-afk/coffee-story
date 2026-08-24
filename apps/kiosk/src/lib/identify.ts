/**
 * THE SECOND SEAM: looking a guest up.
 *
 * This is deliberately not a `@platform/data` call. A kiosk device token
 * cannot read `customers` or `loyalty_accounts` -- `docs/FIVE-SURFACES.md`'s
 * device table says a kiosk may "read the menu, create an order" and may not
 * "read other orders, read customers", and the RLS policies enforce it. So the
 * lookup has to be a narrow server projection behind an endpoint that returns
 * only what a lobby screen may show: a first name and a balance.
 *
 * That endpoint does not exist yet (it needs device pairing first), so this
 * returns an empty account. The screen renders correctly against it -- a guest
 * with no balance sees zero applied and pays in full, which is the honest
 * outcome and not an error state.
 */
export type GuestAccount = {
  /** First name only: this is rendered on a screen a whole room can see. */
  firstName: string | null;
  balanceCents: number;
};

const NO_ACCOUNT: GuestAccount = { firstName: null, balanceCents: 0 };

export function lookupBalance(_maskedPhone: string | null): GuestAccount {
  return NO_ACCOUNT;
}

/** Whether a real lookup is wired. Screens read this, not a comment. */
export const GUEST_LOOKUP_IS_STUBBED = true;
