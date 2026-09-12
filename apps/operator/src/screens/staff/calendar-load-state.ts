/**
 * The calendar's live-fetch lifecycle.
 *
 * `loadLiveCalendarItems(...).catch(() => setBaseItems([]))` used to fold a
 * genuine load failure into the same empty array a quiet day produces, so
 * "the calendar could not be reached" and "nothing is scheduled" rendered as
 * the identical screen. This keeps the three outcomes distinct so a failure
 * gets a retry instead of a shrug.
 */
import type { CalendarItem } from '@/features/calendar/presentation';

export type CalendarLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; items: readonly CalendarItem[] }
  | { status: 'error'; message: string };

export function calendarLoading(): CalendarLoadState {
  return { status: 'loading' };
}

export function calendarLoaded(items: readonly CalendarItem[]): CalendarLoadState {
  return { status: 'loaded', items };
}

export function calendarLoadFailed(error: unknown): CalendarLoadState {
  const message = error instanceof Error && error.message
    ? error.message
    : 'Could not load the calendar. Check your connection and try again.';
  return { status: 'error', message };
}

/** What the schedule list should show for the current day/person filter: a
 * distinct loading and error state so an unresolved or failed fetch is never
 * mistaken for a confirmed empty day. */
export type ScheduleDisplay = 'loading' | 'error' | 'empty' | 'items';

export function scheduleDisplay(state: CalendarLoadState, visibleCount: number): ScheduleDisplay {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'error') return 'error';
  return visibleCount === 0 ? 'empty' : 'items';
}
