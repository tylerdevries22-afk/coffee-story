import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stillpointDemoOccurrences } from './stillpoint-demo';
import { activityAudience, activityLanes } from './activity-kanban';

const tasks = stillpointDemoOccurrences('brand', 'location', new Date('2026-09-04T12:00:00Z'));

describe('activity Kanban', () => {
  it('shows scheduled, claimed, and completed work without cancelled noise', () => {
    const lanes = activityLanes(tasks);
    assert.deepEqual(lanes.map((lane) => lane.tasks.length), [2, 2, 2]);
    assert.deepEqual(lanes.map((lane) => lane.label), ['To do', 'In progress', 'Complete']);
  });

  it('covers every Stillpoint operating audience', () => {
    assert.deepEqual([...new Set(tasks.map(activityAudience))].sort(), [
      'Admin', 'Contractor', 'General Contractor',
    ]);
  });
});
