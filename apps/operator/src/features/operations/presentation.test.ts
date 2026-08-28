import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperationOccurrenceRow } from '@platform/schema';
import { operationChecklist, operationQueueItems, operationTitle } from './presentation';

const row: OperationOccurrenceRow = {
  id: 'one', brand_id: 'brand', location_id: 'location', schedule_id: null, template_id: 'template',
  source: 'manual', materialization_key: 'one', template_snapshot: {
    title: 'Opening readiness', steps: [{ key: 'temperature', title: 'Record temperature',
      responseKind: 'number', required: true, constraints: { minimum: 1, maximum: 10 } }],
  }, scheduled_for: '2026-08-28T10:00:00Z', due_at: '2026-08-28T10:30:00Z',
  grace_minutes: 10, status: 'due', claimed_by: null, claimed_at: null, claim_expires_at: null,
  completed_at: null, completion_note: '', created_at: '2026-08-28T09:00:00Z',
  updated_at: '2026-08-28T09:00:00Z',
};

describe('operation presentation', () => {
  it('reads the tenant-owned title and fails closed without one', () => {
    assert.equal(operationTitle(row), 'Opening readiness');
    assert.equal(operationTitle({ ...row, template_snapshot: {} }), 'Operation');
  });

  it('normalizes snapshotted constraints and drops malformed steps', () => {
    assert.deepEqual(operationChecklist(row), [{
      key: 'temperature', title: 'Record temperature', instructions: '', responseKind: 'number',
      required: true, issueOnFailure: false, minimum: 1, maximum: 10, maxLength: undefined,
    }]);
    assert.deepEqual(operationChecklist({ ...row, template_snapshot: { steps: [null, {}] } }), []);
  });

  it('sorts overdue work before upcoming work without mutating database status', () => {
    const upcoming = { ...row, id: 'two', status: 'upcoming' as const,
      scheduled_for: '2026-08-28T12:00:00Z', due_at: '2026-08-28T12:30:00Z' };
    const items = operationQueueItems([upcoming, row], new Date('2026-08-28T11:00:00Z'));
    assert.deepEqual(items.map((item) => item.row.id), ['one', 'two']);
    assert.equal(row.status, 'due');
  });
});
