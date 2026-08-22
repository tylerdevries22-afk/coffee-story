import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureAppError,
  clearAppError,
  initialAppErrorBoundaryState,
} from './app-error-boundary-state';

test('the app error boundary starts ready', () => {
  assert.deepEqual(initialAppErrorBoundaryState, { status: 'ready' });
});

test('captured errors become a safe user-facing failure state', () => {
  assert.deepEqual(captureAppError(new Error('private stack')), {
    status: 'failed',
    message: 'The app needs a fresh preview before it can continue.',
  });
});

test('clearing a handled error returns to the ready state', () => {
  assert.deepEqual(clearAppError(), initialAppErrorBoundaryState);
});
