import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarPermissionsForRole,
  resolveCalendarCategoryPresentation,
  resolveCalendarDetailTemplate,
  resolveCalendarEntryAccess,
  type CalendarEntry,
  type CalendarViewer,
} from './calendar';

const ENTRY: CalendarEntry = {
  id: 'entry-1',
  brandId: 'brand-1',
  locationId: 'location-1',
  categoryId: 'category-1',
  coreKind: 'training',
  source: { type: 'training', id: 'assignment-1' },
  title: 'Milk texturing',
  status: 'assigned',
  startsAt: '2026-08-24T16:00:00.000Z',
  endsAt: '2026-08-24T17:00:00.000Z',
  timeZone: 'America/Denver',
  allDay: false,
  assignees: [{ userId: 'employee-1', displayName: 'Taylor' }],
  hasConflict: false,
};

function viewer(overrides: Partial<CalendarViewer> = {}): CalendarViewer {
  return {
    userId: 'employee-1',
    brandId: 'brand-1',
    role: 'employee',
    locationIds: ['location-1'],
    ...overrides,
  };
}

test('category presentation prefers valid tenant label, icon, and color', () => {
  assert.deepEqual(
    resolveCalendarCategoryPresentation({
      coreKind: 'training',
      label: 'Certifications',
      iconKey: 'star',
      accentColor: '#123ABC',
    }),
    {
      label: 'Certifications',
      iconKey: 'star',
      accentColor: '#123ABC',
      usedFallback: false,
    },
  );
});
test('category presentation falls back deterministically for invalid tenant data', () => {
  assert.deepEqual(
    resolveCalendarCategoryPresentation({
      coreKind: 'scheduled_shift',
      label: ' ',
      iconKey: null,
      accentColor: 'green',
    }),
    {
      label: 'Scheduled shift',
      iconKey: 'clock-3',
      accentColor: '#059669',
      usedFallback: true,
    },
  );
  assert.equal(resolveCalendarCategoryPresentation(null).iconKey, 'shapes');
});

test('detail template resolution covers every core behavior and unknown input', () => {
  assert.deepEqual(
    [
      'training',
      'project',
      'scheduled_shift',
      'task',
      'order',
      'event',
      'blockout',
      'custom',
    ].map((kind) => resolveCalendarDetailTemplate(kind as CalendarEntry['coreKind'])),
    ['training', 'project', 'shift', 'task', 'order', 'event', 'blockout', 'generic'],
  );
  assert.equal(resolveCalendarDetailTemplate(null), 'generic');
});

test('role permissions reserve scheduling and conflict overrides for authorized roles', () => {
  assert.equal(calendarPermissionsForRole('employee').canEditSchedule, false);
  assert.equal(calendarPermissionsForRole('contractor').canViewTeam, false);
  assert.equal(calendarPermissionsForRole('manager').canManageBlockouts, true);
  assert.equal(calendarPermissionsForRole('manager').canOverrideConflicts, false);
  assert.equal(calendarPermissionsForRole('owner').canOverrideConflicts, true);
});

test('entry access is editable for an in-scope manager and read-only for an assignee', () => {
  assert.deepEqual(resolveCalendarEntryAccess(ENTRY, viewer()), {
    mode: 'read_only',
    reason: 'self_assigned',
  });
  assert.deepEqual(resolveCalendarEntryAccess(ENTRY, viewer({ role: 'manager' })), {
    mode: 'edit',
    reason: 'editable',
  });
});

test('entry access hides out-of-scope and cross-tenant data', () => {
  assert.deepEqual(
    resolveCalendarEntryAccess(ENTRY, viewer({ userId: 'other', role: 'manager', locationIds: [] })),
    { mode: 'hidden', reason: 'out_of_scope' },
  );
  assert.deepEqual(resolveCalendarEntryAccess(ENTRY, viewer({ brandId: 'brand-2', role: 'owner' })), {
    mode: 'hidden',
    reason: 'wrong_tenant',
  });
});
