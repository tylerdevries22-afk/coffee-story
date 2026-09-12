/**
 * What the Locations table says about a location's Square connection.
 *
 * Three states, not two. `squareConnectionStatus` has distinguished
 * 'reauthorization-required' from 'connected' since the OAuth scope contract
 * moved to version 2 -- a grant made under the old contract lacks the
 * `app_fee_money` recipient scope, so payments through it cannot carry the
 * platform fee. The page kept rendering a boolean: a location stuck on the old
 * contract showed "Connected" and offered only Disconnect, never Reconnect.
 *
 * Pure so the mapping is testable without a renderer; the page only draws it.
 */
import type { SquareConnectionUiStatus } from './square-oauth-contract';

export type SquareLocationPill = {
  readonly label: string;
  readonly tone: 'success' | 'warning';
  /** Which control sits beside the pill for someone who manages the location. */
  readonly action: 'disconnect' | 'reconnect' | 'connect';
};

export function squareLocationPill(status: SquareConnectionUiStatus | null): SquareLocationPill {
  switch (status) {
    case 'connected':
      return { label: 'Connected', tone: 'success', action: 'disconnect' };
    case 'reauthorization-required':
      // Reconnect re-runs consent, which is what a stale scope grant needs.
      // Disconnect alone would leave the location unable to take card payments.
      return { label: 'Reconnect Square', tone: 'warning', action: 'reconnect' };
    default:
      return { label: 'Not connected', tone: 'warning', action: 'connect' };
  }
}
