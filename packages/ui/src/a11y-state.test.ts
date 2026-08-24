import assert from 'node:assert/strict';
import { test } from 'node:test';

import { choiceState, disabledState, expandedState, tabState, toggleState } from './a11y-state';

test('accessibility helpers emit native and web state together', () => {
  assert.deepEqual(tabState(true), { accessibilityState: { selected: true }, 'aria-selected': true });
  assert.deepEqual(choiceState(false), { accessibilityState: { checked: false }, 'aria-checked': false });
  assert.deepEqual(toggleState(true), { accessibilityState: { selected: true }, 'aria-pressed': true });
  assert.deepEqual(disabledState(true), { accessibilityState: { disabled: true }, 'aria-disabled': true });
  assert.deepEqual(expandedState(false), { accessibilityState: { expanded: false }, 'aria-expanded': false });
});
