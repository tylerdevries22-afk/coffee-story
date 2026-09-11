import type {
  CalendarCategory, CalendarCategoryPresentation, CalendarCoreKind, CalendarIconKey, CalendarTone,
} from './calendar-types';

type DefaultCategoryPresentation = {
  label: string;
  iconKey: CalendarIconKey;
  accentTone: CalendarTone;
};

const DEFAULT_CATEGORY_PRESENTATION: Record<CalendarCoreKind, DefaultCategoryPresentation> = {
  training: { label: 'Training', iconKey: 'graduation-cap', accentTone: 'secondary' },
  project: { label: 'Project', iconKey: 'briefcase-business', accentTone: 'primary' },
  scheduled_shift: { label: 'Scheduled shift', iconKey: 'clock-3', accentTone: 'success' },
  task: { label: 'Task', iconKey: 'square-check-big', accentTone: 'warning' },
  order: { label: 'Order', iconKey: 'shopping-bag', accentTone: 'accent' },
  event: { label: 'Event', iconKey: 'calendar-days', accentTone: 'secondary' },
  blockout: { label: 'Blockout', iconKey: 'calendar-off', accentTone: 'danger' },
  custom: { label: 'Calendar item', iconKey: 'shapes', accentTone: 'muted' },
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
    accentColor: hasValidColor ? (category?.accentColor as string) : null,
    accentTone: defaults.accentTone,
    usedFallback,
  };
}
