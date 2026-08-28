import { operationDisplayStatus, type OperationDisplayStatus } from '@platform/domain';

import type { CalendarItem } from '@/features/calendar/presentation';
import { operationCalendarId, type OperatorTaskOccurrence } from './model';

const STATUS_LABEL: Readonly<Record<OperationDisplayStatus, string>> = {
  scheduled: 'Scheduled', claimed: 'In progress', completed: 'Complete',
  overdue: 'Overdue', missed: 'Missed', cancelled: 'Cancelled',
};

function dateToken(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).format(date);
}

function dayKey(timestamp: string, now: Date, timeZone: string): string {
  const target = dateToken(new Date(timestamp), timeZone);
  const offset = Array.from({ length: 36 }, (_, index) => index).find((index) => (
    dateToken(new Date(now.getTime() + index * 86_400_000), timeZone) === target
  ));
  return offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `day-${offset ?? -1}`;
}

function timeLabel(timestamp: string, timeZone: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', timeZone,
  });
}

/** Projects authoritative operation occurrences into the shared read-only Calendar. */
export function operationCalendarItems(
  occurrences: readonly OperatorTaskOccurrence[],
  locationName: string,
  timeZone: string,
  now: Date,
): CalendarItem[] {
  return occurrences.map<CalendarItem>((occurrence) => {
    const displayStatus = operationDisplayStatus(occurrence, now);
    const competency = occurrence.snapshot.requiredCompetencyKeys.length > 0
      ? occurrence.snapshot.requiredCompetencyKeys.join(', ')
      : 'No additional training';
    return {
      id: operationCalendarId(occurrence.id),
      operationOccurrenceId: occurrence.id,
      category: 'task',
      title: occurrence.snapshot.title,
      summary: occurrence.snapshot.instructions || 'Complete the assigned checklist during its scheduled window.',
      date: dayKey(occurrence.scheduledFor, now, timeZone),
      startTime: timeLabel(occurrence.scheduledFor, timeZone),
      endTime: timeLabel(occurrence.dueAt, timeZone),
      startsAt: occurrence.scheduledFor,
      detailTemplate: 'task',
      location: locationName,
      project: 'Shift tasks',
      status: STATUS_LABEL[displayStatus],
      assignees: [],
      sections: [{
        title: 'Requirements',
        rows: [
          { label: 'Training', value: competency },
          { label: 'Estimated time', value: `${occurrence.snapshot.estimatedMinutes} minutes` },
        ],
      }],
      primaryAction: 'Open shift task',
    };
  }).sort((left, right) => Date.parse(left.startsAt ?? '') - Date.parse(right.startsAt ?? ''));
}
