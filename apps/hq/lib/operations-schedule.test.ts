import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { operationScheduleRule } from './operations-schedule';

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe('operation schedule form boundary', () => {
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
      anchorOffsetMinutes: '30', intervalMinutes: '60', intervalEndOffsetMinutes: '300' })), {
      scheduleKind: 'open_interval', localStartTime: null, anchorOffsetMinutes: 30,
      intervalMinutes: 60, intervalEndOffsetMinutes: 300,
    });
  });

  it('rejects incomplete, out-of-range, and reversed schedule windows', () => {
    assert.equal(operationScheduleRule(form({ scheduleKind: 'fixed_time', localStartTime: '25:00' })), null);
    assert.equal(operationScheduleRule(form({ scheduleKind: 'closing_offset' })), null);
    assert.equal(operationScheduleRule(form({ scheduleKind: 'open_interval', anchorOffsetMinutes: '60',
      intervalMinutes: '5', intervalEndOffsetMinutes: '30' })), null);
  });
});
