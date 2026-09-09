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
import type { HourSpan } from './hours';

/** How long the bar needs before the earliest window it will promise. */
export const PICKUP_LEAD_MINUTES = 15;
/** Time reserved for a guest to finish the menu and checkout before revalidation. */
export const PICKUP_CHECKOUT_BUFFER_MINUTES = 5;
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
