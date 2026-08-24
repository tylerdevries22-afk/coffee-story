/**
 * Who is on, and what the shift still owes.
 *
 * Pure and clock-injected, because every question here is "right now" and a
 * function that reads the wall clock itself cannot be tested at 4:59pm.
 */
export type Shift = {
  id: string;
  staffName: string;
  role: string;
  startsAt: string;
  endsAt: string;
};

export type ShiftState = 'upcoming' | 'on' | 'ended';

export function shiftState(shift: Shift, now: Date): ShiftState {
  const start = new Date(shift.startsAt).getTime();
  const end = new Date(shift.endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'ended';
  if (now.getTime() < start) return 'upcoming';
  if (now.getTime() >= end) return 'ended';
  return 'on';
}

/**
 * The roster in the order a shift reads it: who is here now, who is next, who
 * has gone. Within a group, by start time -- a roster is a timeline, not an
 * alphabetical list.
 */
const STATE_RANK: Readonly<Record<ShiftState, number>> = { on: 0, upcoming: 1, ended: 2 };

export function sortRoster(shifts: readonly Shift[], now: Date): Shift[] {
  return [...shifts].sort((a, b) => {
    const rank = STATE_RANK[shiftState(a, now)] - STATE_RANK[shiftState(b, now)];
    if (rank !== 0) return rank;
    return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  });
}

/** Whole minutes until a shift ends; 0 once it has. Drives the "leaving soon" cue. */
export function minutesRemaining(shift: Shift, now: Date): number {
  const end = new Date(shift.endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - now.getTime()) / 60_000));
}

/**
 * Whether the floor is about to thin out.
 *
 * Not a countdown per person -- a manager does not need to watch a clock tick.
 * It answers one question: is anyone leaving inside the next half hour, so the
 * next order does not land on a bar that is about to be one person short.
 */
export const LEAVING_SOON_MINUTES = 30;

export function leavingSoon(shifts: readonly Shift[], now: Date): Shift[] {
  return shifts.filter((shift) => {
    if (shiftState(shift, now) !== 'on') return false;
    const left = minutesRemaining(shift, now);
    return left > 0 && left <= LEAVING_SOON_MINUTES;
  });
}
