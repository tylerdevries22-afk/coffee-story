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

export function squareConnectNotice(
  params: { connected?: string; square?: string },
): SquareConnectNotice | null {
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
