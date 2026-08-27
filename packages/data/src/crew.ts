import type { SupabaseClient } from '@supabase/supabase-js';

import type { CrewTaskCompletionRow, CrewTaskRow, ShiftRow, TaskRecurrence } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

export type RosterEntry = ShiftRow & { staffName: string; staffRole: string };

/**
 * Who is on at a location, for one day.
 *
 * Sorted by start rather than by name: the question a crew screen answers is
 * "who is here now and who is next", which is a timeline.
 */
export async function fetchShiftRoster(
  client: SupabaseClient,
  locationId: string,
  serviceDate: string,
): Promise<RosterEntry[]> {
  const dayStart = `${serviceDate}T00:00:00.000Z`;
  const dayEnd = `${serviceDate}T23:59:59.999Z`;
  const rows = await readWithRetry('fetchShiftRoster', (signal) => abortRead(client
    .from('shifts')
    .select('*, brand_users(display_name, role)')
    .eq('location_id', locationId)
    .gte('starts_at', dayStart)
    .lte('starts_at', dayEnd)
    .order('starts_at'), signal)
    .returns<(ShiftRow & { brand_users?: { display_name?: string; role?: string } })[]>());
  return (rows ?? []).map((row) => ({
    ...row,
    staffName: row.brand_users?.display_name?.trim() || 'Team member',
    staffRole: row.brand_users?.role ?? 'staff',
  }));
}

export type ChecklistItem = CrewTaskRow & {
  completedAt: string | null;
  completedBy: string | null;
};

/**
 * One recurrence's checklist for a day, with each item's completion attached.
 *
 * Tasks and completions are separate tables on purpose, so editing a checklist
 * never rewrites the record of who did what yesterday. This is the join that
 * puts them back together for one day's view.
 */
export async function fetchChecklist(
  client: SupabaseClient,
  locationId: string,
  serviceDate: string,
  recurrence: TaskRecurrence,
): Promise<ChecklistItem[]> {
  const taskRows = await readWithRetry('fetchChecklist tasks', (signal) => abortRead(client
    .from('crew_tasks')
    .select('*')
    .eq('recurrence', recurrence)
    .eq('is_active', true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order('sort_order'), signal)
    .returns<CrewTaskRow[]>());

  const doneRows = await readWithRetry('fetchChecklist completions', (signal) => abortRead(client
    .from('crew_task_completions')
    .select('*')
    .eq('location_id', locationId)
    .eq('service_date', serviceDate), signal)
    .returns<CrewTaskCompletionRow[]>());

  const byTask = new Map((doneRows ?? []).map((row) => [row.task_id, row]));
  return (taskRows ?? []).map((task) => {
    const completion = byTask.get(task.id);
    return {
      ...task,
      completedAt: completion?.completed_at ?? null,
      completedBy: completion?.completed_by ?? null,
    };
  });
}

/** How far through a checklist the shift is, for the header. */
export function checklistProgress(items: readonly ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.completedAt !== null).length, total: items.length };
}
