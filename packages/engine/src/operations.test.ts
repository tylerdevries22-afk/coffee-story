import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  generateOperationWindows,
  operationEscalationsToCreate,
  operationMaterializationKey,
  operationOccurrenceInsert,
  type MaterializableOperation,
} from './operations';

const input: MaterializableOperation = {
  scheduleId: 'schedule-1',
  brandId: 'brand-1',
  locationId: 'location-1',
  templateId: 'template-1',
  templateSnapshot: {
    templateId: 'template-1', templateKey: 'opening', programKey: 'opening',
    routineKind: 'opening', revision: 1, title: 'Opening',
    instructions: '', estimatedMinutes: 10, requiredRoleIds: [],
    requiredCompetencyKeys: [], issueCategories: [], steps: [],
  },
  scheduledFor: '2026-08-28T10:00:00Z',
  dueAt: '2026-08-28T10:30:00Z',
  graceMinutes: 10,
};

describe('operations engine', () => {
  it('canonicalizes equivalent instants into one retry key', () => {
    assert.equal(operationMaterializationKey(input), 'schedule-1:1787911200');
    assert.equal(operationMaterializationKey({
      ...input, scheduledFor: '2026-08-28T04:00:00-06:00',
    }), operationMaterializationKey(input));
  });

  it('rejects invalid materialization instants', () => {
    assert.throws(() => operationMaterializationKey({ ...input, scheduledFor: 'tomorrow' }), RangeError);
  });

  it('builds deterministic occurrence inserts with snapshotted grace', () => {
    const row = operationOccurrenceInsert(input, new Date('2026-08-28T09:59:59Z'));
    assert.equal(row.status, 'scheduled');
    assert.equal(row.grace_minutes, 10);
    assert.equal(row.materialization_key, operationMaterializationKey(input));
    assert.equal(row.template_snapshot, input.templateSnapshot);
  });

  it('rejects invalid due windows and grace periods', () => {
    assert.throws(() => operationOccurrenceInsert({ ...input, dueAt: input.scheduledFor }), RangeError);
    assert.throws(() => operationOccurrenceInsert({ ...input, graceMinutes: 1_441 }), RangeError);
  });

  it('returns only newly due escalation stages', () => {
    const rules = [
      { id: 'staff', offsetMinutes: 0, recipientRole: 'eligible_staff' as const, channels: ['push'] as const },
      { id: 'owner', offsetMinutes: 60, recipientRole: 'brand_owner' as const, channels: ['in_app'] as const },
    ];
    assert.deepEqual(operationEscalationsToCreate('2026-08-28T10:00:00Z', rules, new Set(['staff']),
      new Date('2026-08-28T11:01:00Z')).map((rule) => rule.id), ['owner']);
  });

  it('generates opening, hourly, and closing windows from posted hours', () => {
    const base = {
      scheduleId: 'restroom', timezone: 'America/Denver', dueWindowMinutes: 15,
      graceMinutes: 5, locationHours: { mon: [{ open: '08:00', close: '17:00' }] },
    } as const;
    const opening = generateOperationWindows({ ...base,
      rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [1] } }, '2026-08-31', '2026-08-31');
    const interval = generateOperationWindows({ ...base,
      rule: { kind: 'open_interval', intervalMinutes: 60, startOffsetMinutes: 60,
        endOffsetMinutes: -60, weekdays: [1] } }, '2026-08-31', '2026-08-31');
    const closing = generateOperationWindows({ ...base,
      rule: { kind: 'closing_offset', offsetMinutes: 0, weekdays: [1] } }, '2026-08-31', '2026-08-31');
    assert.equal(opening[0]?.scheduledFor, '2026-08-31T14:00:00.000Z');
    assert.equal(interval.length, 8);
    assert.equal(interval[0]?.scheduledFor, '2026-08-31T15:00:00.000Z');
    assert.equal(interval.at(-1)?.scheduledFor, '2026-08-31T22:00:00.000Z');
    assert.equal(closing[0]?.scheduledFor, '2026-08-31T23:00:00.000Z');
  });

  it('carries overnight closing offsets into the next service date', () => {
    const windows = generateOperationWindows({
      scheduleId: 'closing', timezone: 'UTC', dueWindowMinutes: 30, graceMinutes: 0,
      locationHours: { fri: [{ open: '20:00', close: '02:00' }] },
      rule: { kind: 'closing_offset', offsetMinutes: 0, weekdays: [5] },
    }, '2026-08-28', '2026-08-28');
    assert.equal(windows[0]?.scheduledFor, '2026-08-29T02:00:00.000Z');
  });

  it('skips a nonexistent DST wall-clock instant', () => {
    const windows = generateOperationWindows({
      scheduleId: 'dst', timezone: 'America/Denver', dueWindowMinutes: 30, graceMinutes: 0,
      locationHours: {}, rule: { kind: 'fixed_time', localTime: '02:30', weekdays: [7] },
    }, '2026-03-08', '2026-03-08');
    assert.deepEqual(windows, []);
  });

  it('rejects unbounded generation ranges', () => {
    assert.throws(() => generateOperationWindows({
      scheduleId: 'range', timezone: 'UTC', dueWindowMinutes: 30, graceMinutes: 0,
      locationHours: {}, rule: { kind: 'fixed_time', localTime: '12:00', weekdays: [1] },
    }, '2026-01-01', '2026-02-05'), /1 through 35 days/);
  });
});
