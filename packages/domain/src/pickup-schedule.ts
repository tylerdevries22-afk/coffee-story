import { addLocalDays } from './dates';
import { MINUTES_PER_DAY, type HourSpan, type WeekHours } from './hours';
import {
  PICKUP_CHECKOUT_BUFFER_MINUTES, PICKUP_HORIZON_DAYS, PICKUP_LEAD_MINUTES,
  PICKUP_STEP_MINUTES, PICKUP_WINDOW_MINUTES, type PickupSchedule, type PickupWindow,
  type ShopStatus,
} from './pickup-contract';
import { atMinutes, clockLabel, dayLabelFor, pickupTimeLabel, roundUpToStep } from './pickup-labels';

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
