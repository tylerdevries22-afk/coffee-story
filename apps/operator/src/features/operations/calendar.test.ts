import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOperatorQueue } from './model';
import { operationCalendarItems } from './calendar';

test('operation occurrences project to Calendar with a task deep-link identity', () => {
  const occurrences = parseOperatorQueue({ occurrences: [{
    id: '40000000-0000-4000-8000-000000000001',
    brandId: '40000000-0000-4000-8000-000000000002',
    locationId: '40000000-0000-4000-8000-000000000003',
    status: 'scheduled', claimedBy: null,
    scheduledFor: '2026-08-28T15:00:00.000Z', dueAt: '2026-08-28T15:15:00.000Z',
    templateSnapshot: {
      templateId: '40000000-0000-4000-8000-000000000004', title: 'Safety check',
      estimatedMinutes: 5, requiredCompetencyKeys: ['safety'], steps: [],
    },
    eligibility: { eligible: true, hasActiveShift: true },
  }] }).occurrences;
  const items = operationCalendarItems(occurrences, 'Main shop', 'America/Denver',
    new Date('2026-08-28T12:00:00.000Z'));
  assert.equal(items[0]?.id, 'operation-40000000-0000-4000-8000-000000000001');
  assert.equal(items[0]?.operationOccurrenceId, '40000000-0000-4000-8000-000000000001');
  assert.equal(items[0]?.category, 'task');
  assert.equal(items[0]?.location, 'Main shop');
});
