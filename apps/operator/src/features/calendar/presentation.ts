import type { AppIconName } from '@/components/icon-map';
import {
  CALENDAR_CORE_KINDS,
  resolveCalendarCategoryPresentation,
  resolveCalendarDetailTemplate,
  type CalendarCategory as DomainCalendarCategory,
  type CalendarCoreKind,
  type CalendarDetailTemplate,
  type CalendarIconKey,
} from '@platform/domain';

export type CalendarCategoryKind = CalendarCoreKind;

export type CalendarCategory = {
  kind: CalendarCategoryKind;
  label: string;
  icon: AppIconName;
  color: string;
  tint: string;
};

export type CalendarDetailSection = {
  title: string;
  rows: readonly { label: string; value: string }[];
};

export type CalendarItem = {
  id: string;
  category: CalendarCategoryKind;
  title: string;
  summary: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  project: string;
  status: string;
  assignees: readonly { id: string; name: string; initials: string }[];
  sections: readonly CalendarDetailSection[];
  primaryAction: string;
  detailTemplate?: CalendarDetailTemplate;
  startsAt?: string;
  categoryOverride?: { label: string; iconKey: CalendarIconKey; accentColor: string };
  /** Present only for task occurrences projected from the operations system. */
  operationOccurrenceId?: string;
};

const ICONS: Readonly<Record<CalendarIconKey, AppIconName>> = {
  'graduation-cap': 'book.closed',
  'briefcase-business': 'briefcase',
  'clock-3': 'clock',
  'square-check-big': 'checkmark.circle.fill',
  'shopping-bag': 'bag',
  'calendar-days': 'calendar',
  'calendar-off': 'lock',
  shapes: 'calendar',
  coffee: 'cup.and.saucer',
  wrench: 'gearshape',
  'heart-pulse': 'heart.fill',
  users: 'person.2',
  'map-pin': 'mappin',
  star: 'star',
};

const TINTS: Readonly<Record<CalendarCategoryKind, string>> = {
  training: '#F3EAE0', project: '#EDF3EC', scheduled_shift: '#E1F3FE', task: '#FBF3DB',
  order: '#FDEBEC', event: '#E8F3F5', blockout: '#FDEBEC', custom: '#EEE9E4',
};

export function calendarCategory(
  kind: string,
  overrides: Readonly<Partial<Record<CalendarCategoryKind, Partial<DomainCalendarCategory>>>> = {},
): CalendarCategory {
  const normalized = isCalendarCategoryKind(kind) ? kind : 'custom';
  const override = overrides[normalized];
  const presentation = resolveCalendarCategoryPresentation({
    coreKind: normalized,
    label: override?.label ?? '',
    iconKey: override?.iconKey,
    accentColor: override?.accentColor,
  });
  return {
    kind: normalized,
    label: presentation.label,
    icon: ICONS[presentation.iconKey],
    color: presentation.accentColor,
    tint: TINTS[normalized],
  };
}

export function calendarItemHref(id: string): string {
  return `/staff/calendar/${encodeURIComponent(id)}`;
}

export function calendarItemById(items: readonly CalendarItem[], id: string): CalendarItem | null {
  return items.find((item) => item.id === id) ?? null;
}

export function calendarCategoryForItem(item: CalendarItem): CalendarCategory {
  if (!item.categoryOverride) return calendarCategory(item.category);
  return calendarCategory(item.category, { [item.category]: item.categoryOverride });
}

export function calendarDateRail(
  now: Date,
  count = 7,
  timeZone?: string,
): readonly { key: string; weekday: string; day: string }[] {
  if (!Number.isFinite(now.getTime()) || count < 1) return [];
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(now.getTime() + offset * 86_400_000);
    return {
      key: offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `day-${offset}`,
      weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone }).toUpperCase(),
      day: date.toLocaleDateString('en-US', { day: 'numeric', timeZone }),
    };
  });
}

export function calendarDetailTemplate(item: CalendarItem): CalendarDetailTemplate {
  return item.detailTemplate ?? resolveCalendarDetailTemplate(item.category);
}

export function calendarProgressLabels(item: CalendarItem): readonly [string, string, string] {
  const labels: Record<CalendarDetailTemplate, readonly [string, string, string]> = {
    training: ['Assigned', item.status, 'Complete'],
    project: ['Planned', item.status, 'Complete'],
    shift: ['Scheduled', item.status, 'Complete'],
    task: ['Assigned', item.status, 'Complete'],
    order: ['Confirmed', item.status, 'Ready'],
    event: ['Scheduled', item.status, 'Complete'],
    blockout: ['Requested', item.status, 'Ended'],
    generic: ['Created', item.status, 'Complete'],
  };
  return labels[calendarDetailTemplate(item)];
}

function isCalendarCategoryKind(value: string): value is CalendarCategoryKind {
  return (CALENDAR_CORE_KINDS as readonly string[]).includes(value);
}
