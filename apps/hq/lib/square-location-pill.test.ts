/**
 * A stale Square grant must read as something to fix, not as "Connected".
 *
 * square-connection-status.ts has computed 'reauthorization-required' since
 * the scope contract moved to version 2, and its own test proves it. Nothing
 * rendered it: the Locations page drew a boolean, so the one state that means
 * "card payments cannot carry the platform fee" looked identical to healthy
 * and offered only Disconnect.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { squareLocationPill } from './square-location-pill';

describe('squareLocationPill', () => {
  it('draws a stale grant as an action, not as connected', () => {
    const pill = squareLocationPill('reauthorization-required');
    assert.equal(pill.label, 'Reconnect Square');
    assert.equal(pill.tone, 'warning');
    assert.equal(pill.action, 'reconnect');
    assert.notEqual(pill.label, squareLocationPill('connected').label,
      'reauthorization-required and connected must not render the same word');
  });

  it('keeps the two states that were already right', () => {
    assert.deepEqual(squareLocationPill('connected'),
      { label: 'Connected', tone: 'success', action: 'disconnect' });
    assert.deepEqual(squareLocationPill(null),
      { label: 'Not connected', tone: 'warning', action: 'connect' });
  });

  /** Reconnect must re-run consent -- the same entry point as a first connect. */
  it('routes reconnect through consent rather than a bare disconnect', () => {
    assert.equal(squareLocationPill('reauthorization-required').action, 'reconnect');
    assert.notEqual(squareLocationPill('reauthorization-required').action, 'disconnect');
  });
});
