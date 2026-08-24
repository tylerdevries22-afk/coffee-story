import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stepperDecreaseLabel } from './kiosk-stepper';

describe('kiosk stepper labels', () => {
  it('announces removal when the next zero-bound step removes the line', () => {
    assert.equal(stepperDecreaseLabel(1, 0, 'Tiramisu Latte'), 'Remove tiramisu latte');
  });

  it('announces a decrease while the line remains or zero is not allowed', () => {
    assert.equal(stepperDecreaseLabel(2, 0, 'Tiramisu Latte'), 'Decrease tiramisu latte');
    assert.equal(stepperDecreaseLabel(1, 1, 'Tiramisu Latte'), 'Decrease tiramisu latte');
  });
});
