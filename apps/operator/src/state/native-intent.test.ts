import assert from 'node:assert/strict';
import test from 'node:test';

import { redirectSystemPath } from './native-intent';

test('custom-scheme intent URLs stay inside the app shell', () => {
  assert.equal(redirectSystemPath({ path: 'coffeestory://book', initial: true }), '/');
  assert.equal(redirectSystemPath({ path: 'coffeestory://gift?token=abc', initial: false }), '/');
});

test('ordinary router paths are unchanged', () => {
  assert.equal(redirectSystemPath({ path: '/demo', initial: true }), '/demo');
});
