import assert from 'node:assert/strict';
import test from 'node:test';

import { calendarItemsFromRows, type LiveCalendarRows } from './live';

const rows: LiveCalendarRows = {
  categories: [{ id: 'category', core_kind: 'task', name: 'Service Call', icon_key: 'wrench', accent_color: '#123456' }],
  entries: [{ id: 'entry', category_id: 'category', title: 'Inspect unit', summary: 'Run diagnostics', status: 'in_progress', starts_at: '2026-08-24T15:00:00Z', ends_at: '2026-08-24T16:00:00Z', timezone: 'America/Denver', location_id: 'location', project_key: 'Project A', detail: { sections: [{ title: 'Diagnostic', rows: [{ label: 'Appliance', value: 'Oven 2' }] }] } }],
  shifts: [], orders: [], locations: [{ id: 'location', name: 'Denver', timezone: 'America/Denver' }],
};

test('live standalone entries preserve tenant category presentation', () => {
  const [item] = calendarItemsFromRows(rows, new Date('2026-08-24T12:00:00Z'));
  assert.equal(item?.category, 'task');
  assert.deepEqual(item?.categoryOverride, { label: 'Service Call', iconKey: 'wrench', accentColor: '#123456' });
  assert.equal(item?.location, 'Denver');
  assert.deepEqual(item?.sections, [{ title: 'Diagnostic', rows: [{ label: 'Appliance', value: 'Oven 2' }] }]);
});

test('tenant timezone determines calendar day and instant determines sort order', () => {
  const result = calendarItemsFromRows({
    ...rows,
    entries: [
      { ...rows.entries[0]!, id: 'late', starts_at: '2026-08-25T05:30:00Z', ends_at: '2026-08-25T06:00:00Z' },
      { ...rows.entries[0]!, id: 'early', starts_at: '2026-08-24T16:00:00Z', ends_at: '2026-08-24T17:00:00Z' },
    ],
  }, new Date('2026-08-24T12:00:00Z'));
  assert.deepEqual(result.map((item) => [item.id, item.date]), [['early', 'today'], ['late', 'today']]);
});

test('live shifts and scheduled orders are projected into the shared shell', () => {
  const result = calendarItemsFromRows({ ...rows, entries: [], shifts: [{ id: 's', starts_at: '2026-08-24T15:00:00Z', ends_at: '2026-08-24T16:00:00Z', location_id: 'location', brand_user_id: 'abcd-1234', note: '' }], orders: [{ id: 'abcdef123', scheduled_for: '2026-08-25T15:00:00Z', location_id: 'location', status: 'paid', fulfillment_type: 'pickup', note: '' }] }, new Date('2026-08-24T12:00:00Z'));
  assert.deepEqual(result.map((item) => [item.category, item.date]), [['scheduled_shift', 'today'], ['order', 'tomorrow']]);
});
