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

const CONNECT_FAILURES: Record<string, string> = {
  authorization_failed:
    'Square did not complete the authorization exchange. This shop was not connected — start again from Locations.',
  storage_failed:
    'Square authorized the request, but the encrypted connection could not be stored. The issued token was revoked; try connecting again.',
  in_flight:
    'Square cannot be changed while a payment or refund is being reconciled. The existing connection is unchanged; try again after that work finishes.',
  connection_changed:
    'The Square connection changed while this request was open. The new token was cleaned up; reload Locations before trying again.',
  storage_ambiguous:
    'Square connection storage could not be confirmed. Do not retry this connection until an operator resolves the pending transition.',
};

const CONNECT_WARNINGS: Record<string, string> = {
  issued_token_active:
    ' Square did not confirm cleanup of the newly issued token. Revoke this app from the Square dashboard before trying again.',
  previous_token_active:
    ' The new connection is active, but the previous token could not be queued for safe retirement. Revoke this app from the Square dashboard, then reconnect this location.',
};

/**
 * What a disconnect leaves behind.
 */
const DISCONNECTS: Record<string, SquareConnectNotice> = {
  revoked: {
    failed: false,
    message: 'Square is disconnected and the token was revoked at Square. This location can no longer take card payments.',
  },
  in_flight: {
    failed: true,
    message: 'Square cannot be disconnected while a payment or refund is being reconciled. The connection is unchanged; try again after that work finishes.',
  },
  changed: {
    failed: true,
    message: 'The Square connection changed while disconnect started. Nothing was revoked; reload Locations before trying again.',
  },
  stranded: {
    failed: true,
    message: 'Square revocation or local cleanup could not be confirmed. The connection is fenced for operator review; do not retry card setup yet.',
  },
  failed: {
    failed: true,
    message: 'Square could not be disconnected. Nothing was changed — try again.',
  },
};

export function squareConnectNotice(
  params: { connected?: string; square?: string; square_warning?: string; disconnect?: string },
): SquareConnectNotice | null {
  if (params.disconnect) {
    // Same rule as a refusal below: attacker-supplied, so it selects a
    // sentence and is never echoed into one.
    return DISCONNECTS[params.disconnect] ?? DISCONNECTS.failed ?? null;
  }
  if (params.square) {
    const message = REFUSALS[params.square as SquareLocationRefusal | 'unreachable']
      ?? CONNECT_FAILURES[params.square];
    const warning = params.square_warning ? CONNECT_WARNINGS[params.square_warning] : undefined;
    // An unknown reason still has to say something: the owner watched a
    // redirect happen and a silent page would read as a button that does
    // nothing. It must not echo the parameter -- that is attacker-supplied.
    return {
      failed: true,
      message: `${message ?? 'Square could not be connected. Nothing was changed — try again.'}${warning ?? ''}`,
    };
  }
  if (params.connected === '1') {
    const warning = params.square_warning ? CONNECT_WARNINGS[params.square_warning] : undefined;
    return warning
      ? { failed: true, message: `Square is connected. This location can take card payments.${warning}` }
      : { failed: false, message: 'Square is connected. This location can take card payments.' };
  }
  return null;
}
