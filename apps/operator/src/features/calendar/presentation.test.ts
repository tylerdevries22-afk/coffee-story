import assert from 'node:assert/strict';
import test from 'node:test';

import { calendarCategory, calendarCategoryForItem, calendarDateRail, calendarItemHref, calendarProgressLabels, calendarTint, type CalendarItem } from './presentation';

// Two brands with nothing in common, so a test that passes for both is testing
// the indirection rather than one palette.
const BRAND = {
  primary: '#101010', secondary: '#202020', accent: '#303030',
  success: '#404040', warning: '#505050', danger: '#606060', textMuted: '#707070',
} as const;
const OTHER_BRAND = { ...BRAND, success: '#0B7A4B', secondary: '#7A2E0B' } as const;

test('calendar categories resolve distinct task icons', () => {
  assert.equal(calendarCategory('training', BRAND).icon, 'book.closed');
  assert.equal(calendarCategory('project', BRAND).icon, 'briefcase');
  assert.equal(calendarCategory('scheduled_shift', BRAND).icon, 'clock');
});

test('tenant category presentation overrides do not change core behavior', () => {
  const category = calendarCategory('scheduled_shift', BRAND, {
    scheduled_shift: { label: 'Service call', accentColor: '#123456' },
  });
  assert.equal(category.kind, 'scheduled_shift');
  assert.equal(category.label, 'Service call');
  assert.equal(category.color, '#123456');
});

test('unknown categories use the safe generic presentation', () => {
  assert.deepEqual(calendarCategory('retired-category', BRAND).kind, 'custom');
});

test('a live item carries tenant category branding without changing behavior', () => {
  const item = { category: 'task', categoryOverride: { label: 'Service Call', iconKey: 'wrench', accentColor: '#123456' } } as CalendarItem;
  assert.deepEqual(calendarCategoryForItem(item, BRAND), {
    kind: 'task', label: 'Service Call', icon: 'gearshape',
    color: '#123456', tint: '#1234561F',
  });
});

test('a category with no tenant colour takes the brand\'s, not the platform\'s', () => {
  // The regression this guards: these used to be literal hexes in the domain,
  // so every brand after the first got a violet training chip and a green shift
  // rail it never picked.
  assert.equal(calendarCategory('scheduled_shift', BRAND).color, BRAND.success);
  assert.equal(calendarCategory('scheduled_shift', OTHER_BRAND).color, OTHER_BRAND.success);
  assert.equal(calendarCategory('training', OTHER_BRAND).color, OTHER_BRAND.secondary);
  assert.equal(calendarCategory('blockout', BRAND).color, BRAND.danger);
  assert.equal(calendarCategory('retired-category', BRAND).color, BRAND.textMuted);
});

test('the tint follows the colour it sits under, whatever the brand set', () => {
  assert.equal(calendarCategory('blockout', BRAND).tint, `${BRAND.danger}1F`);
  // Anything that is not a six-digit hex is left alone rather than corrupted:
  // appending alpha to `rgba(...)` yields a value that renders as transparent.
  assert.equal(calendarTint('rgba(0,0,0,0.5)'), 'rgba(0,0,0,0.5)');
  assert.equal(calendarTint('#ABCDEF'), '#ABCDEF1F');
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
