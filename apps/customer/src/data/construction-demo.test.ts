import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONSTRUCTION_CHANGE_REQUESTS,
  CONSTRUCTION_DOCUMENTS,
  CONSTRUCTION_PROGRESS_DRAWS,
} from './construction-demo';

test('construction preview data names each promised read-only project concept', () => {
  assert.match(CONSTRUCTION_CHANGE_REQUESTS[0]?.detail ?? '', /Approval is not connected/);
  assert.deepEqual(CONSTRUCTION_PROGRESS_DRAWS.map((draw) => draw.status),
    ['Received', 'Not issued']);
  assert.deepEqual(CONSTRUCTION_DOCUMENTS.map((document) => document.title), [
    'Project scope summary', 'Selection schedule', 'Payment schedule',
  ]);
});

test('preview records do not claim a live action', () => {
  const copy = JSON.stringify({
    changes: CONSTRUCTION_CHANGE_REQUESTS,
    draws: CONSTRUCTION_PROGRESS_DRAWS,
    documents: CONSTRUCTION_DOCUMENTS,
  });
  assert.doesNotMatch(copy, /approve now|pay now|download now/i);
});
