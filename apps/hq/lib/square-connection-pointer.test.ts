import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { recordSquareConnectionPointer } from './square-admin';
import {
  BRAND, LOCATION, adminHarness,
} from './square-admin-test-support';

describe('recordSquareConnectionPointer', () => {
  it('scopes the compatibility pointer and confirms the row', async () => {
    const h = adminHarness({ connection: null });
    assert.equal(await recordSquareConnectionPointer(h.db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), true);
    assert.deepEqual(h.writes, [{ square_connection_id: 'connection' }]);
    assert.deepEqual(h.filters, [{ id: LOCATION }, { brand_id: BRAND }]);
  });

  it('does not report a zero-row update as successful', async () => {
    const h = adminHarness({ connection: null, pointerOk: false });
    assert.equal(await recordSquareConnectionPointer(h.db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), false);
  });
});
