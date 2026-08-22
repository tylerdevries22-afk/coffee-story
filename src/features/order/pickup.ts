/**
 * Pickup and delivery windows, derived from the shop's posted hours.
 *
 * The order header shows one of these as "Today · 5:30 – 6:00 PM", and the
 * bag and checkout carry it through. Pure, and built on the local-calendar
 * helpers in `features/dates.ts` rather than on `toISOString().slice(0, 10)`,
 * which names tomorrow from late afternoon onward everywhere Colorado is.
 */
import { addLocalDays, localIsoDate } from '@/features/dates';

/** Sunday-indexed opening hours, in minutes past local midnight. */
type ShopDayHours = { openMinutes: number; closeMinutes: number };

/**
 * Sun–Thu 8am–11pm, Fri–Sat 8am–midnight, from coffeestoryco.com.
 * Index 0 is Sunday, matching `Date.prototype.getDay`.
 */
export const SHOP_HOURS: readonly ShopDayHours[] = [
  { openMinutes: 8 * 60, closeMinutes: 23 * 60 },
  { openMinutes: 8 * 60, closeMinutes: 23 * 60 },
  { openMinutes: 8 * 60, closeMinutes: 23 * 60 },
  { openMinutes: 8 * 60, closeMinutes: 23 * 60 },
  { openMinutes: 8 * 60, closeMinutes: 23 * 60 },
  { openMinutes: 8 * 60, closeMinutes: 24 * 60 },
  { openMinutes: 8 * 60, closeMinutes: 24 * 60 },
];

/** How long the bar needs before the earliest window it will promise. */
export const PICKUP_LEAD_MINUTES = 15;
/** Length of one window. */
export const PICKUP_WINDOW_MINUTES = 30;
/** Windows start on this grid, so the list reads 5:15, 5:30, 5:45. */
export const PICKUP_STEP_MINUTES = 15;
/** How far ahead the picker offers. Two days of windows is plenty. */
export const PICKUP_HORIZON_DAYS = 2;

export type PickupWindow = {
  /** ISO instant the window opens. The value the rest of the app stores. */
  value: string;
  /** "Today" / "Tomorrow" / "Sat". */
  dayLabel: string;
  /** "5:30 – 6:00 PM". */
  timeLabel: string;
};

export function hoursForDay(date: Date): ShopDayHours {
  return SHOP_HOURS[date.getDay()] ?? SHOP_HOURS[0];
}

function atMinutes(day: Date, minutes: number): Date {
  const next = new Date(day.getTime());
  next.setHours(0, minutes, 0, 0);
  return next;
}

function roundUpToStep(date: Date): Date {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  const remainder = next.getMinutes() % PICKUP_STEP_MINUTES;
  if (remainder !== 0) next.setMinutes(next.getMinutes() + (PICKUP_STEP_MINUTES - remainder));
  return next;
}

function dayLabelFor(start: Date, now: Date): string {
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

/**
 * The next `count` bookable windows, rolling into tomorrow once today's last
 * one no longer fits before close.
 *
 * A window has to *end* by closing time: promising a 11:45pm–12:15am pickup on
 * a Tuesday hands the guest a slot with nobody behind the bar.
 */
export function pickupWindows(now: Date, count: number): PickupWindow[] {
  if (Number.isNaN(now.getTime()) || !Number.isFinite(count) || count < 1) return [];
  const windows: PickupWindow[] = [];
  let cursor = roundUpToStep(new Date(now.getTime() + PICKUP_LEAD_MINUTES * 60_000));

  for (let dayOffset = 0; dayOffset <= PICKUP_HORIZON_DAYS && windows.length < count; dayOffset += 1) {
    const day = addLocalDays(now, dayOffset);
    const { openMinutes, closeMinutes } = hoursForDay(day);
    const opensAt = atMinutes(day, openMinutes);
    // closeMinutes can be 24 * 60, which `setHours(0, 1440)` resolves to
    // midnight on the following day -- exactly the Friday/Saturday close.
    const closesAt = atMinutes(day, closeMinutes);
    const lastStart = new Date(closesAt.getTime() - PICKUP_WINDOW_MINUTES * 60_000);
    if (cursor < opensAt) cursor = opensAt;

    while (cursor <= lastStart && windows.length < count) {
      windows.push({
        value: cursor.toISOString(),
        dayLabel: dayLabelFor(cursor, now),
        timeLabel: pickupTimeLabel(cursor),
      });
      cursor = new Date(cursor.getTime() + PICKUP_STEP_MINUTES * 60_000);
    }
    // Nothing left today: restart the search at the next day's opening.
    cursor = atMinutes(addLocalDays(now, dayOffset + 1), 0);
  }

  return windows;
}

export type ShopStatus = {
  open: boolean;
  /** "Now brewing", "Opens 8:00 AM", "Opens 8:00 AM tomorrow". */
  label: string;
};

/**
 * Whether the shop is serving right now, for the badge on a location card.
 *
 * The badge used to read "Now Brewing" unconditionally, which told a guest at
 * one in the morning that the bar was pouring.
 */
export function shopStatus(now: Date): ShopStatus {
  if (Number.isNaN(now.getTime())) return { open: false, label: 'Hours unavailable' };
  const { openMinutes, closeMinutes } = hoursForDay(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= openMinutes && minutes < closeMinutes) return { open: true, label: 'Now brewing' };
  if (minutes < openMinutes) return { open: false, label: `Opens ${clockLabel(now, openMinutes)}` };
  const tomorrow = addLocalDays(now, 1);
  return { open: false, label: `Opens ${clockLabel(tomorrow, hoursForDay(tomorrow).openMinutes)} tomorrow` };
}

function clockLabel(day: Date, minutes: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(atMinutes(day, minutes));
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
