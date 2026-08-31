import {
  CALENDAR_CORE_KINDS,
  resolveCalendarCategoryPresentation,
  resolveCalendarDetailTemplate,
  type CalendarCategory as DomainCalendarCategory,
  type CalendarCoreKind,
  type CalendarDetailTemplate,
  type CalendarIconKey,
  type CalendarTone,
} from '@platform/domain';
import type { AppIconName, BrandTokens } from '@platform/ui';

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

/**
 * Where a tone lands in this tenant's palette.
 *
 * The domain names the role and this map is the only place that role becomes a
 * colour, so a brand that sets `success` to its own green gets its own green on
 * every shift in the calendar without touching a screen. `muted` reads from
 * `textMuted` rather than a sixth brand colour: the uncategorised item is
 * deliberately the quiet one.
 */
const TONE_TOKEN: Readonly<Record<CalendarTone, keyof CalendarPaletteSource>> = {
  primary: 'primary', secondary: 'secondary', accent: 'accent',
  success: 'success', warning: 'warning', danger: 'danger', muted: 'textMuted',
};

type CalendarPaletteSource = Pick<
  BrandTokens,
  'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'danger' | 'textMuted'
>;

/**
 * The tint is the accent at low opacity, not a second colour.
 *
 * It used to be a hand-picked table of eight washes, which had to be re-picked
 * by hand for every brand and silently went wrong the moment a tenant set an
 * accent the table had never seen -- amber type on a lilac chip. Deriving it
 * means a tint can never disagree with the colour it sits under.
 *
 * Only a six-digit hex is extended; anything else (a named colour, an rgba
 * string a tenant put in `brand_config`) is returned untouched, because
 * appending two characters to it would produce a value that parses as nothing
 * and renders as transparent.
 */
const SIX_DIGIT_HEX = /^#[\dA-F]{6}$/i;
/** ~12%: a wash dark type still holds against at arm's length on an iPad. */
const TINT_ALPHA = '1F';

export function calendarTint(color: string): string {
  return SIX_DIGIT_HEX.test(color) ? `${color}${TINT_ALPHA}` : color;
}

/**
 * A category in the shape a screen draws, resolved against one brand.
 *
 * `tokens` is a parameter rather than a hook so this module stays plain
 * TypeScript that `node:test` can reach -- the repo has no component renderer,
 * so a hook here would be a colour path nothing ever executes before a shop
 * depends on it.
 */
export function calendarCategory(
  kind: string,
  tokens: CalendarPaletteSource,
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
  // The tenant's own colour wins; otherwise the tone picks one out of their
  // palette. Neither branch can produce a colour this platform invented.
  const color = presentation.accentColor ?? tokens[TONE_TOKEN[presentation.accentTone]];
  return {
    kind: normalized,
    label: presentation.label,
    icon: ICONS[presentation.iconKey],
    color,
    tint: calendarTint(color),
  };
}

export function calendarItemHref(id: string): string {
  return `/staff/calendar/${encodeURIComponent(id)}`;
}

export function calendarItemById(items: readonly CalendarItem[], id: string): CalendarItem | null {
  return items.find((item) => item.id === id) ?? null;
}

export function calendarCategoryForItem(
  item: CalendarItem,
  tokens: CalendarPaletteSource,
): CalendarCategory {
  if (!item.categoryOverride) return calendarCategory(item.category, tokens);
  return calendarCategory(item.category, tokens, { [item.category]: item.categoryOverride });
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
