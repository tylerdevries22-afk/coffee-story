import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '@platform/api-client';

import {
  OPERATION_INTENT_VERSION,
  createOperationIntentQueue,
  enqueueOperationIntent,
} from '@platform/offline';
import { drainOperationIntents, operationIntentFailure } from './reconcile';

const BRAND_ID = '30000000-0000-4000-8000-000000000001';
const LOCATION_ID = '30000000-0000-4000-8000-000000000002';

test('retryable failures stop the FIFO without consuming later actions', async () => {
  let queue = createOperationIntentQueue(BRAND_ID, LOCATION_ID);
  for (const [index, actionId] of [
    '30000000-0000-4000-8000-000000000010',
    '30000000-0000-4000-8000-000000000011',
  ].entries()) {
    queue = enqueueOperationIntent(queue, {
      version: OPERATION_INTENT_VERSION, kind: 'claim', actionId,
      brandId: BRAND_ID, locationId: LOCATION_ID,
      occurrenceId: `30000000-0000-4000-8000-00000000002${index}`,
      createdAt: '2026-08-27T12:00:00.000Z',
    });
  }
  let submissions = 0;
  const drained = await drainOperationIntents(queue, async () => {
    submissions += 1;
    return { outcome: 'retry' };
  });
  assert.equal(submissions, 1);
  assert.equal(drained.records.length, 2);
});

test('conclusive failures remain visible as conflicts while unrelated work continues', async () => {
  let queue = createOperationIntentQueue(BRAND_ID, LOCATION_ID);
  queue = enqueueOperationIntent(queue, {
    version: OPERATION_INTENT_VERSION, kind: 'claim',
    actionId: '30000000-0000-4000-8000-000000000010', brandId: BRAND_ID,
    locationId: LOCATION_ID, occurrenceId: '30000000-0000-4000-8000-000000000020',
    createdAt: '2026-08-27T12:00:00.000Z',
  });
  queue = enqueueOperationIntent(queue, {
    version: OPERATION_INTENT_VERSION, kind: 'claim',
    actionId: '30000000-0000-4000-8000-000000000011', brandId: BRAND_ID,
    locationId: LOCATION_ID, occurrenceId: '30000000-0000-4000-8000-000000000021',
    createdAt: '2026-08-27T12:01:00.000Z',
  });
  let submissions = 0;
  const drained = await drainOperationIntents(queue, async () => {
    submissions += 1;
    return submissions === 1
      ? { outcome: 'conflict', code: 'conflict', message: 'Already claimed.' }
      : { outcome: 'confirmed' };
  }, () => new Date('2026-08-27T12:02:00.000Z'));
  assert.equal(drained.records.length, 1);
  assert.equal(drained.records[0]?.status, 'conflict');
});

test('API status determines retry versus visible conflict', () => {
  assert.equal(operationIntentFailure(new ApiError(503, 'down', 'Unavailable')).outcome, 'retry');
  assert.equal(operationIntentFailure(new ApiError(409, 'conflict', 'Changed')).outcome, 'conflict');
  assert.equal(operationIntentFailure(new Error('offline')).outcome, 'retry');
});
