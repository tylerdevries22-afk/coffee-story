import {
  operationDisplayStatus,
  type OperationDisplayStatus,
} from '@platform/domain';

import type {
  OperatorTaskOccurrence,
} from './model-types';
import { isOperationId } from './model-parsers';

export { parseOperatorNotifications, parseOperatorQueue } from './model-parsers';

export type {
  OperatorChecklistStep, OperatorEligibility, OperatorNotification,
  OperatorQueueSnapshot, OperatorTaskIssue, OperatorTaskOccurrence,
  OperatorTaskSnapshot,
} from './model-types';

export function displayStatusForTask(task: OperatorTaskOccurrence, now: Date): OperationDisplayStatus {
  return operationDisplayStatus(task, now);
}

export function taskIsActionable(task: OperatorTaskOccurrence, now: Date): boolean {
  const status = displayStatusForTask(task, now);
  return task.eligibility.eligible
    && now.getTime() >= Date.parse(task.scheduledFor)
    && ['scheduled', 'claimed', 'overdue'].includes(status);
}

export function taskEligibilityMessage(task: OperatorTaskOccurrence): string | null {
  if (!task.eligibility.hasActiveShift) return 'You need an active shift before claiming this task.';
  if (task.eligibility.missingCompetencies.length > 0) {
    return `Training required: ${task.eligibility.missingCompetencies.join(', ')}`;
  }
  if (task.eligibility.missingRoles.length > 0) {
    return `Assigned role required: ${task.eligibility.missingRoles.join(', ')}`;
  }
  return task.eligibility.eligible ? null : 'You are not eligible to claim this task.';
}

export function operationCalendarId(occurrenceId: string): string {
  return `operation-${occurrenceId}`;
}

export function occurrenceIdFromCalendarId(itemId: string): string | null {
  const id = itemId.startsWith('operation-') ? itemId.slice('operation-'.length) : '';
  return isOperationId(id) ? id : null;
}
