import assert from 'node:assert/strict';
import test from 'node:test';

import {
  occurrenceIdFromCalendarId,
  operationCalendarId,
  parseOperatorNotifications,
  parseOperatorQueue,
  taskEligibilityMessage,
  taskIsActionable,
} from './model';

const ID = '10000000-0000-4000-8000-000000000001';

test('the queue parser rejects malformed tenant rows and retains valid checklists', () => {
  const parsed = parseOperatorQueue({ occurrences: [{
    id: ID,
    brandId: '10000000-0000-4000-8000-000000000002',
    locationId: '10000000-0000-4000-8000-000000000003',
    status: 'scheduled', scheduledFor: '2026-08-27T12:00:00.000Z', dueAt: '2026-08-27T12:15:00.000Z',
    templateSnapshot: {
      templateId: '10000000-0000-4000-8000-000000000004', templateKey: 'check', revision: 1,
      title: 'Guest area check', instructions: '', estimatedMinutes: 5,
      requiredRoleIds: [], requiredCompetencyKeys: [], issueCategories: ['hazard'],
      steps: [{ key: 'safe', title: 'Area is safe', responseKind: 'pass_fail', required: true }],
    },
    eligibility: { eligible: true, hasActiveShift: true },
  }, { id: 'not-a-uuid' }] });
  assert.equal(parsed.occurrences.length, 1);
  assert.equal(parsed.occurrences[0]?.snapshot.steps[0]?.title, 'Area is safe');
});

test('calendar operation identifiers round trip and reject foreign identifiers', () => {
  assert.equal(occurrenceIdFromCalendarId(operationCalendarId(ID)), ID);
  assert.equal(occurrenceIdFromCalendarId('shift-123'), null);
});

test('notification parsing preserves system rows without operation deep links', () => {
  const notifications = parseOperatorNotifications({ notifications: [{
    id: ID, occurrence_id: null, title: 'System notice', body: 'Schedule updated',
    created_at: '2026-08-27T12:00:00.000Z', read_at: null,
  }, {
    id: '10000000-0000-4000-8000-000000000002', occurrenceId: ID,
    title: 'Task due', body: 'Guest area check', createdAt: '2026-08-27T12:05:00.000Z',
  }, { id: ID, occurrence_id: 42, title: 'Invalid', body: 'Invalid', created_at: 'now' }] });
  assert.deepEqual(notifications.map((item) => item.occurrenceId), [null, ID]);
});

test('eligibility messaging prioritizes the active shift and competency blockers', () => {
  const occurrence = parseOperatorQueue({ occurrences: [{
    id: ID, brandId: '10000000-0000-4000-8000-000000000002',
    locationId: '10000000-0000-4000-8000-000000000003', status: 'scheduled',
    scheduledFor: '2026-08-27T12:00:00.000Z', dueAt: '2026-08-27T12:15:00.000Z',
    templateSnapshot: { templateId: ID, title: 'Check', steps: [] },
    eligibility: { eligible: false, hasActiveShift: true, missingCompetencies: ['Safety'] },
  }] }).occurrences[0];
  assert.equal(occurrence ? taskEligibilityMessage(occurrence) : null, 'Training required: Safety');
});

test('missing eligibility fails closed and N/A capability survives parsing', () => {
  const occurrence = parseOperatorQueue({ occurrences: [{
    id: ID, brandId: '10000000-0000-4000-8000-000000000002',
    locationId: '10000000-0000-4000-8000-000000000003', status: 'scheduled',
    scheduledFor: '2026-08-27T12:00:00.000Z', dueAt: '2026-08-27T12:15:00.000Z',
    templateSnapshot: { templateId: ID, title: 'Check', steps: [{ key: 'trash',
      title: 'Empty trash', responseKind: 'confirm', allowNotApplicable: true }] },
  }] }).occurrences[0];
  assert.equal(occurrence?.eligibility.eligible, false);
  assert.equal(occurrence?.snapshot.steps[0]?.allowNotApplicable, true);
  assert.equal(occurrence ? taskEligibilityMessage(occurrence) : null,
    'You need an active shift before claiming this task.');
});

test('terminal operations are never actionable from notification deep links', () => {
  const base = parseOperatorQueue({ occurrences: [{
    id: ID, brandId: '10000000-0000-4000-8000-000000000002',
    locationId: '10000000-0000-4000-8000-000000000003', status: 'scheduled',
    scheduledFor: '2026-08-27T12:00:00.000Z', dueAt: '2026-08-27T12:15:00.000Z',
    templateSnapshot: { templateId: ID, title: 'Check', steps: [] },
    eligibility: { eligible: true, hasActiveShift: true },
  }] }).occurrences[0];
  assert.ok(base);
  const now = new Date('2026-08-27T12:10:00.000Z');
  assert.equal(taskIsActionable(base, now), true);
  for (const status of ['completed', 'missed', 'cancelled'] as const) {
    assert.equal(taskIsActionable({ ...base, status }, now), false);
  }
});
