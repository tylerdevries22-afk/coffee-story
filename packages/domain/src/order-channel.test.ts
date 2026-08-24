import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isOwnedChannel, resolveOrderChannel } from './order-channel';

describe('resolveOrderChannel', () => {
  /** The bug this replaces: the old ternary could never emit 'kiosk'. */
  it('attributes a lobby kiosk to the kiosk', () => {
    assert.equal(resolveOrderChannel({ deviceRole: 'kiosk' }), 'kiosk');
  });

  it('attributes a paired register to the counter', () => {
    assert.equal(resolveOrderChannel({ deviceRole: 'pos' }), 'pos');
  });

  it('attributes a staff user to the counter and a guest to the app', () => {
    assert.equal(resolveOrderChannel({ staffRole: 'location_manager' }), 'pos');
    assert.equal(resolveOrderChannel({ staffRole: null }), 'app');
    assert.equal(resolveOrderChannel({}), 'app');
  });

  it('prefers the device over a staff role, because the device is where it happened', () => {
    assert.equal(resolveOrderChannel({ deviceRole: 'kiosk', staffRole: 'staff' }), 'kiosk');
  });

  it('does not attribute a display or prep tablet to a till', () => {
    // Those roles must be rejected before they reach this; falling through to
    // 'pos' would silently book an order against a screen that cannot take one.
    assert.equal(resolveOrderChannel({ deviceRole: 'display' }), 'app');
    assert.equal(resolveOrderChannel({ deviceRole: 'prep' }), 'app');
  });
});

describe('isOwnedChannel', () => {
  /**
   * `in_app_share` filters on ('app','web'), so a kiosk sale lands in the
   * denominator and never the numerator -- the owner's "share through our own
   * platform" falls as more guests use the shop's own hardware.
   */
  it('counts the kiosk as the brand own platform, which in_app_share does not', () => {
    assert.equal(isOwnedChannel('kiosk'), true);
    assert.equal(isOwnedChannel('kiosk'), true,
      'a kiosk is the most owned channel a shop has');
  });

  it('excludes a counter sale from the owned-platform share', () => {
    assert.equal(isOwnedChannel('pos'), false);
  });
});
