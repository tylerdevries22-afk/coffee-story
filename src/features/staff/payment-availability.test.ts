import assert from 'node:assert/strict';
import test from 'node:test';

import { isStaffTenderAvailable, type StaffTenderKey } from './payment-availability';

const DEMO_ONLY_TENDERS: readonly StaffTenderKey[] = [
  'square',
  'tap',
  'cash',
  'check',
  'gift',
  'credit',
  'onfile',
];

test('unconnected tenders stay available in Demo but cannot report live success', () => {
  for (const tender of DEMO_ONLY_TENDERS) {
    assert.equal(isStaffTenderAvailable(tender, true), true);
    assert.equal(isStaffTenderAvailable(tender, false), false);
  }
});

test('only the implemented secure card sheet remains available in live mode', () => {
  assert.equal(isStaffTenderAvailable('card', false), true);
});
