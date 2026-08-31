import type { SquareLocationRefusal } from '@platform/engine';

/**
 * What Locations tells an owner whose browser has just come back from Square.
 *
 * Consent can finish without the shop being connected: the merchant may have
 * several active locations, none, or one that settles in another currency, and
 * the callback refuses all three rather than binding a guess. Nothing is
 * written in those cases, so the page must say what happened -- otherwise the
 * owner returns to an unchanged Locations table and reads it as a dead button.
 *
 * Pulled out of the page because it is the part worth testing: a refusal that
 * renders as nothing is the failure this exists to prevent.
 */
export type SquareConnectNotice = { failed: boolean; message: string };

const REFUSALS: Record<SquareLocationRefusal | 'unreachable', string> = {
  several_locations:
    'That Square account has more than one active location. This shop was not connected, because billing the wrong one would send its takings to another store.',
  unsupported_currency:
    'That Square account settles in another currency. This platform bills in US dollars, so the shop was not connected.',
  no_active_location:
    'That Square account has no active location to bill. Activate one in Square, then connect again.',
  unreachable:
    'Square did not answer when asked which location to bill. Nothing was changed — try connecting again.',
};

/**
 * What a disconnect leaves behind, in the two states it can end in.
 *
 * `local_only` is not a failure of the disconnect -- the shop is disconnected
 * either way -- but it leaves the owner a job only they can do, so it is
 * styled as a warning rather than a confirmation.
 */
const DISCONNECTS: Record<string, SquareConnectNotice> = {
  revoked: {
    failed: false,
    message: 'Square is disconnected and the token was revoked at Square. This location can no longer take card payments.',
  },
  local_only: {
    failed: true,
    message: 'Square is disconnected here, but Square did not confirm the revocation. That token can stay usable for the rest of its thirty days — revoke this app from your Square dashboard to be certain.',
  },
  stranded: {
    failed: true,
    message: 'Square was told to revoke this token, but the connection could not be cleared here. This location cannot take card payments until it is — disconnect it again.',
  },
  failed: {
    failed: true,
    message: 'Square could not be disconnected. Nothing was changed — try again.',
  },
};

export function squareConnectNotice(
  params: { connected?: string; square?: string; disconnect?: string },
): SquareConnectNotice | null {
  if (params.disconnect) {
    // Same rule as a refusal below: attacker-supplied, so it selects a
    // sentence and is never echoed into one.
    return DISCONNECTS[params.disconnect] ?? DISCONNECTS.failed ?? null;
  }
  if (params.square) {
    const message = REFUSALS[params.square as SquareLocationRefusal | 'unreachable'];
    // An unknown reason still has to say something: the owner watched a
    // redirect happen and a silent page would read as a button that does
    // nothing. It must not echo the parameter -- that is attacker-supplied.
    return { failed: true, message: message ?? 'Square could not be connected. Nothing was changed — try again.' };
  }
  if (params.connected === '1') {
    return { failed: false, message: 'Square is connected. This location can take card payments.' };
  }
  return null;
}
