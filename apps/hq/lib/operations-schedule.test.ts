import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { operationScheduleKindForRoutine, operationScheduleRule } from './operations-schedule';

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe('operation schedule form boundary', () => {
  it('maps each routine to its one valid schedule shape', () => {
    assert.deepEqual([
      operationScheduleKindForRoutine('opening'),
      operationScheduleKindForRoutine('interval'),
      operationScheduleKindForRoutine('closing'),
      operationScheduleKindForRoutine('ad_hoc'),
    ], ['opening_offset', 'open_interval', 'closing_offset', 'fixed_time']);
  });

  it('normalizes each supported schedule kind', () => {
    assert.deepEqual(operationScheduleRule(form({ scheduleKind: 'fixed_time', localStartTime: '07:30' })), {
      scheduleKind: 'fixed_time', localStartTime: '07:30', anchorOffsetMinutes: null,
      intervalMinutes: null, intervalEndOffsetMinutes: null,
    });
    assert.deepEqual(operationScheduleRule(form({ scheduleKind: 'opening_offset', anchorOffsetMinutes: '-15' })), {
      scheduleKind: 'opening_offset', localStartTime: null, anchorOffsetMinutes: -15,
      intervalMinutes: null, intervalEndOffsetMinutes: null,
    });
    assert.deepEqual(operationScheduleRule(form({ scheduleKind: 'open_interval',
      anchorOffsetMinutes: '60', intervalMinutes: '60', intervalEndOffsetMinutes: '-60' })), {
      scheduleKind: 'open_interval', localStartTime: null, anchorOffsetMinutes: 60,
      intervalMinutes: 60, intervalEndOffsetMinutes: -60,
    });
  });

  it('rejects incomplete and out-of-range schedule rules', () => {
    assert.equal(operationScheduleRule(form({ scheduleKind: 'fixed_time', localStartTime: '25:00' })), null);
    assert.equal(operationScheduleRule(form({ scheduleKind: 'closing_offset' })), null);
    assert.equal(operationScheduleRule(form({ scheduleKind: 'open_interval', anchorOffsetMinutes: '60',
      intervalMinutes: '5', intervalEndOffsetMinutes: '30' })), null);
  });
});
