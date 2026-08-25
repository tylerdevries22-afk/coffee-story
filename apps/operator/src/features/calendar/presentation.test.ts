import assert from 'node:assert/strict';
import test from 'node:test';

import { calendarCategory, calendarCategoryForItem, calendarDateRail, calendarItemHref, calendarProgressLabels, type CalendarItem } from './presentation';

test('calendar categories resolve distinct task icons', () => {
  assert.equal(calendarCategory('training').icon, 'book.closed');
  assert.equal(calendarCategory('project').icon, 'briefcase');
  assert.equal(calendarCategory('scheduled_shift').icon, 'clock');
});

test('tenant category presentation overrides do not change core behavior', () => {
  const category = calendarCategory('scheduled_shift', {
    scheduled_shift: { label: 'Service call', accentColor: '#123456' },
  });
  assert.equal(category.kind, 'scheduled_shift');
  assert.equal(category.label, 'Service call');
  assert.equal(category.color, '#123456');
});

test('unknown categories use the safe generic presentation', () => {
  assert.deepEqual(calendarCategory('retired-category').kind, 'custom');
});

test('a live item carries tenant category branding without changing behavior', () => {
  const item = { category: 'task', categoryOverride: { label: 'Service Call', iconKey: 'wrench', accentColor: '#123456' } } as CalendarItem;
  assert.deepEqual(calendarCategoryForItem(item), { kind: 'task', label: 'Service Call', icon: 'gearshape', color: '#123456', tint: '#FBF3DB' });
});

test('detail routes encode external identifiers', () => {
  assert.equal(calendarItemHref('shift/42'), '/staff/calendar/shift%2F42');
});

test('the date rail starts today and remains calendar-ordered', () => {
  const dates = calendarDateRail(new Date(2026, 7, 24), 3);
  assert.deepEqual(dates.map(({ key, day }) => [key, day]), [
    ['today', '24'], ['tomorrow', '25'], ['day-2', '26'],
  ]);
});

test('calendar details use a workflow tailored to the item category', () => {
  const order = { category: 'order', status: 'Preparing' } as CalendarItem;
  assert.deepEqual(calendarProgressLabels(order), ['Confirmed', 'Preparing', 'Ready']);
});
