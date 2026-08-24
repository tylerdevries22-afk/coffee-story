import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { availableTenders } from './tenders';

describe('availableTenders', () => {
  it('does not advertise balance tenders while lookup is a stub', () => {
    assert.deepEqual(
      availableTenders(['card', 'stored_value', 'gift_card'], {
        allowsCash: false,
        hasBalanceLookup: false,
      }),
      ['card'],
    );
  });

  it('offers pay at counter only when the device posture allows staff collection', () => {
    assert.deepEqual(
      availableTenders(['card', 'cash'], { allowsCash: false, hasBalanceLookup: true }),
      ['card'],
    );
    assert.deepEqual(
      availableTenders(['card', 'cash'], { allowsCash: true, hasBalanceLookup: true }),
      ['card', 'cash'],
    );
  });

  it('keeps configured order once capabilities exist', () => {
    assert.deepEqual(
      availableTenders(['stored_value', 'card', 'gift_card'], {
        allowsCash: true,
        hasBalanceLookup: true,
      }),
      ['stored_value', 'card', 'gift_card'],
    );
  });
});
