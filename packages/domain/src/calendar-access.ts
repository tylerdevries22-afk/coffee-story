import type {
  CalendarCoreKind, CalendarDetailTemplate, CalendarEntry, CalendarEntryAccess,
  CalendarPermissions, CalendarViewer, CalendarWorkforceRole,
} from './calendar-types';

const DETAIL_TEMPLATES: Record<CalendarCoreKind, CalendarDetailTemplate> = {
  training: 'training',
  project: 'project',
  scheduled_shift: 'shift',
  task: 'task',
  order: 'order',
  event: 'event',
  blockout: 'blockout',
  custom: 'generic',
};

/** Selects a safe detail renderer without allowing tenant configuration to inject routes. */
export function resolveCalendarDetailTemplate(
  coreKind?: CalendarCoreKind | null,
): CalendarDetailTemplate {
  return DETAIL_TEMPLATES[coreKind ?? 'custom'];
}


export function calendarPermissionsForRole(role: CalendarWorkforceRole): CalendarPermissions {
  if (role === 'owner') {
    return {
      canViewTeam: true,
      canCreate: true,
      canEditSchedule: true,
      canManageBlockouts: true,
      canOverrideConflicts: true,
    };
  }

  if (role === 'manager') {
    return {
      canViewTeam: true,
      canCreate: true,
      canEditSchedule: true,
      canManageBlockouts: true,
      canOverrideConflicts: false,
    };
  }

  return {
    canViewTeam: false,
    canCreate: false,
    canEditSchedule: false,
    canManageBlockouts: false,
    canOverrideConflicts: false,
  };
}


export function resolveCalendarEntryAccess(
  entry: Pick<CalendarEntry, 'brandId' | 'locationId' | 'assignees'>,
  viewer: CalendarViewer,
): CalendarEntryAccess {
  if (entry.brandId !== viewer.brandId) {
    return { mode: 'hidden', reason: 'wrong_tenant' };
  }

  const assignedToViewer = entry.assignees.some(({ userId }) => userId === viewer.userId);
  const locationInScope = entry.locationId === null || viewer.locationIds.includes(entry.locationId);
  const permissions = calendarPermissionsForRole(viewer.role);

  if (permissions.canEditSchedule && locationInScope) {
    return { mode: 'edit', reason: 'editable' };
  }

  if (assignedToViewer) {
    return { mode: 'read_only', reason: 'self_assigned' };
  }

  return { mode: 'hidden', reason: 'out_of_scope' };
}
