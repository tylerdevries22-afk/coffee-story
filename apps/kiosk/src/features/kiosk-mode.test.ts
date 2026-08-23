import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { postureFor } from './kiosk-mode';

describe('postureFor', () => {
  it('gives a lobby kiosk no cash and no order lookup', () => {
    const posture = postureFor('kiosk');
    assert.ok(posture);
    assert.equal(posture.unattended, true);
    assert.equal(posture.allowsCashTender, false);
    // Looking an order up shows a guest's name to whoever is standing there.
    assert.equal(posture.allowsOrderLookup, false);
    assert.equal(posture.channel, 'kiosk');
  });

  it('gives an attended register cash, lookup, and no idle reset', () => {
    const posture = postureFor('pos');
    assert.ok(posture);
    assert.equal(posture.allowsCashTender, true);
    assert.equal(posture.allowsOrderLookup, true);
    // Resetting a register mid-transaction loses the queue the barista is
    // holding in their head.
    assert.equal(posture.idleResets, false);
    assert.equal(posture.channel, 'pos');
  });

  it('refuses a display or prep token outright', () => {
    // Those roles pair to different surfaces; running this binary on one would
    // mean a screen with an order-create scope it was never granted.
    assert.equal(postureFor('display'), null);
    assert.equal(postureFor('prep'), null);
  });
});
