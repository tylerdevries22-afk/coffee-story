import { addLocalDays, localIsoDate } from './dates';
import {
  PICKUP_LEAD_MINUTES, PICKUP_STEP_MINUTES, PICKUP_WINDOW_MINUTES, type PickupWindow,
} from './pickup-contract';

export function atMinutes(day: Date, minutes: number): Date {
  const next = new Date(day.getTime());
  next.setHours(0, minutes, 0, 0);
  return next;
}

export function roundUpToStep(date: Date): Date {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  const remainder = next.getMinutes() % PICKUP_STEP_MINUTES;
  if (remainder !== 0) next.setMinutes(next.getMinutes() + (PICKUP_STEP_MINUTES - remainder));
  return next;
}

export function dayLabelFor(start: Date, now: Date): string {
  const today = localIsoDate(now);
  const startDay = localIsoDate(start);
  if (startDay === today) return 'Today';
  if (startDay === localIsoDate(addLocalDays(now, 1))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(start);
}

/** "5:30 – 6:00 PM", with the meridiem stated once when both ends share it. */
export function pickupTimeLabel(start: Date, minutes = PICKUP_WINDOW_MINUTES): string {
  const end = new Date(start.getTime() + minutes * 60_000);
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const startText = formatter.format(start);
  const endText = formatter.format(end);
  const startMeridiem = startText.slice(-2);
  const endMeridiem = endText.slice(-2);
  return startMeridiem === endMeridiem
    ? `${startText.slice(0, -3)} – ${endText}`
    : `${startText} – ${endText}`;
}

export function clockLabel(day: Date, minutes: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(atMinutes(day, minutes));
}

/**
 * Whether a window chosen earlier can still be honoured.
 *
 * The picker is only consulted while the Details step is mounted, and a guest
 * can easily spend longer than one window browsing a sixty-item menu. Without
 * this, an order placed at 5:40 for a 5:15-5:45 window is stored at 5:15 and
 * lands in Past orders the moment it is confirmed.
 */
export function isWindowStillBookable(value: string, now: Date): boolean {
  const start = new Date(value);
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return false;
  return start.getTime() >= now.getTime() + PICKUP_LEAD_MINUTES * 60_000;
}

/** The label pair for a stored window value, or null if it is not a real time. */
export function describePickupWindow(value: string, now: Date): PickupWindow | null {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return null;
  return {
    value,
    dayLabel: dayLabelFor(start, now),
    timeLabel: pickupTimeLabel(start),
  };
}
