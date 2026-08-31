/**
 * Pickup and delivery windows, derived from the shop's posted hours.
 *
 * The order header shows one of these as "Today · 5:30 – 6:00 PM", and the
 * bag and checkout carry it through. Pure, and built on the local-calendar
 * helpers in `./dates` rather than on `toISOString().slice(0, 10)`, which
 * names tomorrow from late afternoon onward everywhere Colorado is.
 *
 * This module was duplicated byte-for-byte in the customer and operator apps
 * around a hand-written `SHOP_HOURS` table -- Sun-Thu 8am-11pm, one shop's
 * week, in two places, while brand.json already held the same week as data.
 * It lives here now and takes the week from the tenant, so a shop open 6am to
 * 2pm is offered windows until 2pm in both apps and nowhere is there a
 * constant to remember to change.
 */
import { addLocalDays, localIsoDate } from './dates';
import { MINUTES_PER_DAY, type HourSpan, type WeekHours } from './hours';

/** How long the bar needs before the earliest window it will promise. */
export const PICKUP_LEAD_MINUTES = 15;
/** Time reserved for a guest to finish the menu and checkout before revalidation. */
const PICKUP_CHECKOUT_BUFFER_MINUTES = 5;
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
 * A shop's schedule, bound to one week of hours.
 *
 * A factory rather than an hours argument on every call: `pickupWindows` and
 * `shopStatus` must agree about the week or a guest is offered a slot the
 * badge says the shop is shut for, and binding it once makes disagreeing
 * impossible rather than merely unlikely.
 */
export type PickupSchedule = {
  /** The day's spans, in opening order. Empty when the shop is closed. */
  hoursForDay(date: Date): readonly HourSpan[];
  /**
   * The next `count` bookable windows, rolling forward once today's last one
   * no longer fits before close.
   *
   * A window has to *end* by closing time: promising a 11:45pm-12:15am pickup
   * on a Tuesday hands the guest a slot with nobody behind the bar. Days the
   * shop is closed contribute nothing and the search moves on, so a shop shut
   * on Mondays offers Tuesday rather than a Monday morning nobody will work.
   */
  pickupWindows(now: Date, count: number): PickupWindow[];
  /** Whether the shop is serving right now, for the badge on a location card. */
  shopStatus(now: Date): ShopStatus;
};

export type ShopStatus = {
  open: boolean;
  /** "Now brewing", "Opens 8:00 AM", "Opens 8:00 AM Tuesday". */
  label: string;
};

/**
 * A schedule for a tenant whose hours are missing or unfinished.
 *
 * Offers nothing and says so. The alternative -- falling back to some default
 * week -- would sell a pickup slot against hours no shop ever posted, and the
 * guest arriving to a locked door has no way to know that is what happened.
 */
const UNKNOWN_HOURS: PickupSchedule = {
  hoursForDay: () => [],
  pickupWindows: () => [],
  shopStatus: () => ({ open: false, label: 'Hours unavailable' }),
};

export function pickupSchedule(hours: WeekHours | null): PickupSchedule {
  if (!hours || hours.length !== 7) return UNKNOWN_HOURS;

  function hoursForDay(date: Date): readonly HourSpan[] {
    return hours?.[date.getDay()] ?? [];
  }

  function pickupWindows(now: Date, count: number): PickupWindow[] {
    if (Number.isNaN(now.getTime()) || !Number.isFinite(count) || count < 1) return [];
    const windows: PickupWindow[] = [];
    const earliest = now.getTime()
      + (PICKUP_LEAD_MINUTES + PICKUP_CHECKOUT_BUFFER_MINUTES) * 60_000;
    let cursor = roundUpToStep(new Date(earliest));

    for (let offset = 0; offset <= PICKUP_HORIZON_DAYS && windows.length < count; offset += 1) {
      const day = addLocalDays(now, offset);
      for (const span of hoursForDay(day)) {
        if (windows.length >= count) break;
        const opensAt = atMinutes(day, span.openMinutes);
        // closeMinutes can be 24 * 60, which `setHours(0, 1440)` resolves to
        // midnight on the following day -- exactly a Friday/Saturday close.
        const closesAt = atMinutes(day, span.closeMinutes);
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
      }
      // Nothing left today: restart the search at the next day's opening.
      cursor = atMinutes(addLocalDays(now, offset + 1), 0);
    }

    return windows;
  }

  /**
   * The badge used to read "Now Brewing" unconditionally, which told a guest
   * at one in the morning that the bar was pouring.
   */
  function shopStatus(now: Date): ShopStatus {
    if (Number.isNaN(now.getTime())) return { open: false, label: 'Hours unavailable' };
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = hoursForDay(now);
    // A span that ran past midnight belongs to yesterday's day-of-week, so an
    // order at 00:30 on Saturday is inside Friday's 8am-12am and the badge has
    // to look back a day to see it.
    const yesterday = addLocalDays(now, -1);
    for (const span of hoursForDay(yesterday)) {
      if (span.closeMinutes > MINUTES_PER_DAY && minutes < span.closeMinutes - MINUTES_PER_DAY) {
        return { open: true, label: 'Now brewing' };
      }
    }
    for (const span of today) {
      if (minutes >= span.openMinutes && minutes < span.closeMinutes) {
        return { open: true, label: 'Now brewing' };
      }
    }
    const laterToday = today.find((span) => minutes < span.openMinutes);
    if (laterToday) {
      return { open: false, label: `Opens ${clockLabel(now, laterToday.openMinutes)}` };
    }
    // Scan the rest of the week rather than assuming tomorrow: a shop closed
    // Sunday and Monday must not promise it opens tomorrow on a Saturday night.
    for (let offset = 1; offset <= 7; offset += 1) {
      const day = addLocalDays(now, offset);
      const first = hoursForDay(day)[0];
      if (!first) continue;
      const when = offset === 1
        ? 'tomorrow'
        : new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(day);
      return { open: false, label: `Opens ${clockLabel(day, first.openMinutes)} ${when}` };
    }
    return { open: false, label: 'Hours unavailable' };
  }

  return { hoursForDay, pickupWindows, shopStatus };
}

function clockLabel(day: Date, minutes: number): string {
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
