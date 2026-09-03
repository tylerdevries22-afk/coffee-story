import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPERATION_INTENT_VERSION,
  confirmOperationIntent,
  createOperationIntentQueue,
  enqueueOperationIntent,
  isOperationIntent,
  recordPermanentIntentConflict,
} from './index';

const BRAND_ID = '10000000-0000-4000-8000-000000000001';
const LOCATION_ID = '10000000-0000-4000-8000-000000000002';
const OCCURRENCE_ID = '10000000-0000-4000-8000-000000000003';
const CLAIM_ID = '10000000-0000-4000-8000-000000000004';
const COMPLETE_ID = '10000000-0000-4000-8000-000000000005';

test('a confirmed claim keeps its dependent completion queued independently', () => {
  const empty = createOperationIntentQueue(BRAND_ID, LOCATION_ID);
  const claimed = enqueueOperationIntent(empty, {
    version: OPERATION_INTENT_VERSION,
    kind: 'claim', actionId: CLAIM_ID, brandId: BRAND_ID, locationId: LOCATION_ID,
    occurrenceId: OCCURRENCE_ID, createdAt: '2026-08-27T12:00:00.000Z',
  });
  const completed = enqueueOperationIntent(claimed, {
    version: OPERATION_INTENT_VERSION,
    kind: 'complete', actionId: COMPLETE_ID, brandId: BRAND_ID, locationId: LOCATION_ID,
    occurrenceId: OCCURRENCE_ID, createdAt: '2026-08-27T12:01:00.000Z',
    claimActionId: CLAIM_ID, responses: { clean: true }, note: '', issues: [],
  });
  const confirmed = confirmOperationIntent(completed, CLAIM_ID);
  assert.equal(confirmed.records.length, 1);
  const remaining = confirmed.records[0]?.intent;
  assert.equal(remaining?.kind, 'complete');
  if (remaining?.kind === 'complete') assert.equal(remaining.claimActionId, null);
});

test('completion validation requires well-formed atomic issue evidence', () => {
  assert.equal(isOperationIntent({
    version: OPERATION_INTENT_VERSION,
    kind: 'complete', actionId: COMPLETE_ID, brandId: BRAND_ID, locationId: LOCATION_ID,
    occurrenceId: OCCURRENCE_ID, createdAt: '2026-08-27T12:01:00.000Z',
    claimActionId: null, responses: { hazard: false }, note: '',
    issues: [{ category: 'hazard', severity: 'high', description: 'Wet floor', stepKey: 'hazard' }],
  }), true);
  assert.equal(isOperationIntent({
    version: OPERATION_INTENT_VERSION,
    kind: 'complete', actionId: COMPLETE_ID, brandId: BRAND_ID, locationId: LOCATION_ID,
    occurrenceId: OCCURRENCE_ID, createdAt: '2026-08-27T12:01:00.000Z',
    claimActionId: null, responses: {}, note: '', issues: [{ category: '', severity: 'high' }],
  }), false);
  assert.equal(isOperationIntent({
    version: OPERATION_INTENT_VERSION,
    kind: 'complete', actionId: COMPLETE_ID, brandId: BRAND_ID, locationId: LOCATION_ID,
    occurrenceId: OCCURRENCE_ID, createdAt: '2026-08-27T12:01:00.000Z',
    claimActionId: null, responses: { trash: { state: 'not_applicable', reason: 'Bin is absent.' } },
    note: '', issues: [],
  }), true);
  assert.equal(isOperationIntent({
    version: OPERATION_INTENT_VERSION,
    kind: 'complete', actionId: COMPLETE_ID, brandId: BRAND_ID, locationId: LOCATION_ID,
    occurrenceId: OCCURRENCE_ID, createdAt: '2026-08-27T12:01:00.000Z',
    claimActionId: null, responses: { trash: { state: 'not_applicable', reason: '' } },
    note: '', issues: [],
  }), false);
});

test('a permanent claim conflict also marks its dependent completion', () => {
  let queue = createOperationIntentQueue(BRAND_ID, LOCATION_ID);
  queue = enqueueOperationIntent(queue, {
    version: OPERATION_INTENT_VERSION, kind: 'claim', actionId: CLAIM_ID,
    brandId: BRAND_ID, locationId: LOCATION_ID, occurrenceId: OCCURRENCE_ID,
    createdAt: '2026-08-27T12:00:00.000Z',
  });
  queue = enqueueOperationIntent(queue, {
    version: OPERATION_INTENT_VERSION, kind: 'complete', actionId: COMPLETE_ID,
    brandId: BRAND_ID, locationId: LOCATION_ID, occurrenceId: OCCURRENCE_ID,
    createdAt: '2026-08-27T12:01:00.000Z', claimActionId: CLAIM_ID,
    responses: { clean: true }, note: '', issues: [],
  });
  const conflicted = recordPermanentIntentConflict(queue, CLAIM_ID, {
    code: 'conflict', message: 'Claimed by another worker.', recordedAt: '2026-08-27T12:02:00.000Z',
  });
  assert.deepEqual(conflicted.records.map((entry) => entry.status), ['conflict', 'conflict']);
});
