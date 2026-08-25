/** Framework-free calendar contracts shared by every tenant surface. */

export const CALENDAR_CORE_KINDS = [
  'training',
  'project',
  'scheduled_shift',
  'task',
  'order',
  'event',
  'blockout',
  'custom',
] as const;

export type CalendarCoreKind = (typeof CALENDAR_CORE_KINDS)[number];

export const CALENDAR_ICON_KEYS = [
  'graduation-cap',
  'briefcase-business',
  'clock-3',
  'square-check-big',
  'shopping-bag',
  'calendar-days',
  'calendar-off',
  'shapes',
  'coffee',
  'wrench',
  'heart-pulse',
  'users',
  'map-pin',
  'star',
] as const;

export type CalendarIconKey = (typeof CALENDAR_ICON_KEYS)[number];

export type CalendarCategory = {
  id: string;
  brandId: string;
  /** Stable behavior key. A tenant may change the label without changing this. */
  coreKind: CalendarCoreKind;
  label: string;
  iconKey?: CalendarIconKey | null;
  accentColor?: string | null;
  enabled: boolean;
  sortOrder: number;
};

export type CalendarCategoryPresentation = {
  label: string;
  iconKey: CalendarIconKey;
  accentColor: string;
  usedFallback: boolean;
};

type DefaultCategoryPresentation = Omit<CalendarCategoryPresentation, 'usedFallback'>;

const DEFAULT_CATEGORY_PRESENTATION: Record<CalendarCoreKind, DefaultCategoryPresentation> = {
  training: { label: 'Training', iconKey: 'graduation-cap', accentColor: '#7C3AED' },
  project: { label: 'Project', iconKey: 'briefcase-business', accentColor: '#2563EB' },
  scheduled_shift: { label: 'Scheduled shift', iconKey: 'clock-3', accentColor: '#059669' },
  task: { label: 'Task', iconKey: 'square-check-big', accentColor: '#D97706' },
  order: { label: 'Order', iconKey: 'shopping-bag', accentColor: '#DB2777' },
  event: { label: 'Event', iconKey: 'calendar-days', accentColor: '#0891B2' },
  blockout: { label: 'Blockout', iconKey: 'calendar-off', accentColor: '#DC2626' },
  custom: { label: 'Calendar item', iconKey: 'shapes', accentColor: '#64748B' },
};

const HEX_COLOR = /^#[\dA-F]{6}$/i;

/** Resolves tenant presentation, falling back safely for missing or invalid data. */
export function resolveCalendarCategoryPresentation(
  category?: Pick<CalendarCategory, 'coreKind' | 'label' | 'iconKey' | 'accentColor'> | null,
): CalendarCategoryPresentation {
  const coreKind = category?.coreKind ?? 'custom';
  const defaults = DEFAULT_CATEGORY_PRESENTATION[coreKind];
  const label = category?.label.trim();
  const hasValidColor = HEX_COLOR.test(category?.accentColor ?? '');
  const usedFallback = !category || !label || !category.iconKey || !hasValidColor;

  return {
    label: label || defaults.label,
    iconKey: category?.iconKey ?? defaults.iconKey,
    accentColor: hasValidColor ? (category?.accentColor as string) : defaults.accentColor,
    usedFallback,
  };
}
export type CalendarEntrySource = {
  type: CalendarCoreKind;
  id: string;
};

export type CalendarAssignee = {
  userId: string;
  displayName: string;
  roleLabel?: string | null;
  avatarUrl?: string | null;
};

export type CalendarEntry = {
  id: string;
  brandId: string;
  locationId: string | null;
  categoryId: string | null;
  coreKind: CalendarCoreKind;
  source: CalendarEntrySource;
  projectId?: string | null;
  title: string;
  summary?: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  allDay: boolean;
  assignees: readonly CalendarAssignee[];
  hasConflict: boolean;
};

export type CalendarDetailTemplate =
  | 'training'
  | 'project'
  | 'shift'
  | 'task'
  | 'order'
  | 'event'
  | 'blockout'
  | 'generic';

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

export type CalendarWorkforceRole = 'owner' | 'manager' | 'employee' | 'contractor';

export type CalendarPermissions = {
  canViewTeam: boolean;
  canCreate: boolean;
  canEditSchedule: boolean;
  canManageBlockouts: boolean;
  canOverrideConflicts: boolean;
};

/** Central permission defaults; authorization services may further restrict location scope. */
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

export type CalendarViewer = {
  userId: string;
  brandId: string;
  role: CalendarWorkforceRole;
  locationIds: readonly string[];
};

export type CalendarEntryAccess = {
  mode: 'edit' | 'read_only' | 'hidden';
  reason: 'editable' | 'self_assigned' | 'out_of_scope' | 'wrong_tenant';
};

/**
 * Resolves coarse UI access. Database RLS remains authoritative; this helper
 * prevents detail screens from exposing editing affordances while data loads.
 */
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
