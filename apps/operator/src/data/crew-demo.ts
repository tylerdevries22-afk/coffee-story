import type { ChecklistItem } from '@/features/crew/checklist';
import type { Shift } from '@/features/crew/shift';

/** Today, as the demo plane sees it, so the roster is never a day in the past. */
function todayAt(hour: number, minute = 0): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/**
 * A day's floor.
 *
 * Shaped so the screen has to handle what a real shift does: someone finishing
 * within the hour, someone mid-shift, someone not in yet, and a closer whose
 * shift runs past midnight.
 */
export const DEMO_SHIFTS: readonly Shift[] = [
  { id: 'shift-1', staffName: 'Mike A.', role: 'Lead barista', startsAt: todayAt(7), endsAt: todayAt(15) },
  { id: 'shift-2', staffName: 'Sara D.', role: 'Barista', startsAt: todayAt(9), endsAt: todayAt(17) },
  { id: 'shift-3', staffName: 'Devin P.', role: 'Baker', startsAt: todayAt(5), endsAt: todayAt(13) },
  { id: 'shift-4', staffName: 'Quinn N.', role: 'Barista', startsAt: todayAt(16), endsAt: todayAt(23, 30) },
];

export const DEMO_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: 'open-1', title: 'Unlock and disarm', detail: 'Front door, then the panel behind the bar.',
    recurrence: 'opening', sortOrder: 1, completedAt: todayAt(7, 2), completedBy: 'Mike A.',
  },
  {
    id: 'open-2', title: 'Calibrate the grinder', detail: 'Pull two shots and check the timing.',
    recurrence: 'opening', sortOrder: 2, completedAt: todayAt(7, 18), completedBy: 'Mike A.',
  },
  {
    id: 'open-3', title: 'Fill the pastry case', detail: "Everything from this morning's bake.",
    recurrence: 'opening', sortOrder: 3, completedAt: null, completedBy: null,
  },
  {
    id: 'close-1', title: 'Backflush the group heads', detail: 'Three cycles each.',
    recurrence: 'closing', sortOrder: 1, completedAt: null, completedBy: null,
  },
  {
    id: 'close-2', title: 'Count the drawer', detail: 'Two people, both initial the sheet.',
    recurrence: 'closing', sortOrder: 2, completedAt: null, completedBy: null,
  },
  {
    id: 'close-3', title: 'Log waste', detail: 'Anything unsold from the case.',
    recurrence: 'closing', sortOrder: 3, completedAt: null, completedBy: null,
  },
  {
    id: 'daily-1', title: 'Wipe the syrup rail', detail: 'Between rushes, whenever it is quiet.',
    recurrence: 'daily', sortOrder: 1, completedAt: null, completedBy: null,
  },
];

/** The signed-in barista, until auth wires in. */
export const DEMO_CREW_MEMBER = 'Mike A.';
