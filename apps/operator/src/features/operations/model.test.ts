import assert from 'node:assert/strict';
import test from 'node:test';

import {
  occurrenceIdFromCalendarId,
  operationCalendarId,
  parseOperatorQueue,
  taskEligibilityMessage,
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
