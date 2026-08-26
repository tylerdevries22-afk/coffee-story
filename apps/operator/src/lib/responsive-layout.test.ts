import assert from 'node:assert/strict';
import test from 'node:test';

import { operatorLayout } from './responsive-layout';

test('uses one board lane on a phone', () => {
  assert.deepEqual(operatorLayout(390, 844), {
    isTablet: false,
    isLandscape: false,
    contentMaxWidth: 390,
    boardColumnsVisible: 1,
  });
});

test('uses two visible lanes on an iPad in portrait', () => {
  const layout = operatorLayout(768, 1024);
  assert.equal(layout.isTablet, true);
  assert.equal(layout.isLandscape, false);
  assert.equal(layout.boardColumnsVisible, 2);
  assert.equal(layout.contentMaxWidth, 1120);
});

test('uses the full three-lane board on a tablet in landscape', () => {
  const layout = operatorLayout(1366, 1024);
  assert.equal(layout.isTablet, true);
  assert.equal(layout.isLandscape, true);
  assert.equal(layout.boardColumnsVisible, 3);
});

test('does not classify a short landscape phone as a tablet', () => {
  assert.equal(operatorLayout(844, 390).isTablet, false);
});
