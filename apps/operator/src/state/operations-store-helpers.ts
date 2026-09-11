import { newIdempotencyKey } from '@platform/api-client';
import {
  OPERATION_INTENT_VERSION,
  type OperationIntent,
  type OperationIntentQueue,
} from '@platform/offline';

import type { OperatorTaskOccurrence } from '@/features/operations/model';
import type { OperationConflict } from '@/state/operations-state';

export function operationRange(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
    to: new Date(now.getTime() + 35 * 24 * 60 * 60_000).toISOString(),
  };
}

export function operationActionBase(brandId: string, locationId: string, occurrenceId: string):
Pick<OperationIntent, 'version' | 'actionId' | 'brandId' | 'locationId' | 'occurrenceId' | 'createdAt'> {
  return { version: OPERATION_INTENT_VERSION, actionId: newIdempotencyKey(), brandId,
    locationId, occurrenceId, createdAt: new Date().toISOString() };
}

export function optimisticOperationTask(task: OperatorTaskOccurrence, intent: OperationIntent,
  actorId: string): OperatorTaskOccurrence {
  if (task.id !== intent.occurrenceId) return task;
  if (intent.kind === 'claim') return { ...task, status: 'claimed', claimedBy: actorId, claimedAt: intent.createdAt };
  if (intent.kind === 'release') return { ...task, status: 'scheduled', claimedBy: null, claimedAt: null, claimExpiresAt: null };
  if (intent.kind === 'complete') return { ...task, status: 'completed', completedAt: intent.createdAt,
    completedBy: actorId, completionNote: intent.note };
  return task;
}

export function operationConflictList(queue: OperationIntentQueue): OperationConflict[] {
  return queue.records.flatMap((record) => record.status === 'conflict' ? [{
    actionId: record.intent.actionId, occurrenceId: record.intent.occurrenceId,
    message: record.conflict.message,
  }] : []);
}
