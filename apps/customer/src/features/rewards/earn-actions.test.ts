import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EARN_ACTIONS, earnActionState } from './earn-actions';

test('earn actions preserve the product order and behavior catalogue', () => {
  assert.deepEqual(EARN_ACTIONS.map((action) => action.key), [
    'share_experience', 'refer_friend', 'add_birthday', 'complete_intake', 'google_review', 'enable_reminders',
  ]);
  assert.equal(EARN_ACTIONS.find((action) => action.key === 'refer_friend')?.behavior, 'sheet');
  assert.equal(EARN_ACTIONS.find((action) => action.key === 'google_review')?.behavior, 'link');
});

test('completed actions are inert in every mode', () => {
  const action = EARN_ACTIONS[0];
  assert.deepEqual(earnActionState(action, [action.key], false), {
    complete: true, awaitingStudio: false, inert: true,
  });
});

test('non-claim actions remain interactive when they have local work', () => {
  const refer = EARN_ACTIONS.find((action) => action.key === 'refer_friend');
  const review = EARN_ACTIONS.find((action) => action.key === 'google_review');
  assert.ok(refer);
  assert.ok(review);
  assert.equal(earnActionState(refer, [], false).inert, false);
  assert.equal(earnActionState(review, [], false).inert, false);
});

test('inert actions are studio-confirmed only outside demo mode', () => {
  const action = EARN_ACTIONS.find((entry) => entry.key === 'enable_reminders');
  assert.ok(action);
  assert.deepEqual(earnActionState(action, [], false), {
    complete: false, awaitingStudio: true, inert: true,
  });
  assert.deepEqual(earnActionState(action, [], true), {
    complete: false, awaitingStudio: false, inert: false,
  });
});
