import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPackResponse } from './boot';

const VALID = { businessName: 'Harbor Roast', removeHref: '/d/token/remove', builder: { name: 'Acme', contactHref: null } };

describe('isPackResponse', () => {
  it('accepts a response with the three fields the boot module reads', () => {
    assert.ok(isPackResponse(VALID));
  });

  it('rejects anything missing businessName, removeHref, or a named builder', () => {
    for (const bad of [
      null,
      undefined,
      'not an object',
      {},
      { ...VALID, businessName: undefined },
      { ...VALID, removeHref: 42 },
      { ...VALID, builder: null },
      { ...VALID, builder: {} },
      { ...VALID, builder: { name: 42 } },
    ]) {
      assert.equal(isPackResponse(bad), false, JSON.stringify(bad));
    }
  });
});
