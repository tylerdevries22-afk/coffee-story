import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChecklistItem } from './crew';
import { checklistProgress } from './crew';

function item(id: string, completedAt: string | null): ChecklistItem {
  return {
    id,
    brand_id: 'b',
    location_id: null,
    title: id,
    detail: '',
    recurrence: 'opening',
    sort_order: 0,
    is_active: true,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    completedAt,
    completedBy: completedAt ? 'user-1' : null,
  };
}

describe('checklistProgress', () => {
  it('counts only completed items', () => {
    assert.deepEqual(
      checklistProgress([item('a', '2026-08-23T08:00:00Z'), item('b', null), item('c', null)]),
      { done: 1, total: 3 },
    );
  });

  it('reports 0 of 0 for an empty checklist rather than NaN', () => {
    assert.deepEqual(checklistProgress([]), { done: 0, total: 0 });
  });
});
