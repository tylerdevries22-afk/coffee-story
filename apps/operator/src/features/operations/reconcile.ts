import { ApiError } from '@platform/api-client';

import {
  confirmOperationIntent,
  recordPermanentIntentConflict,
  type OperationIntent,
  type OperationIntentQueue,
} from './offline-intents';

export type OperationIntentSubmitResult =
  | { outcome: 'confirmed' }
  | { outcome: 'retry' }
  | { outcome: 'conflict'; code: string; message: string };

export function operationIntentFailure(error: unknown): OperationIntentSubmitResult {
  if (!(error instanceof ApiError)) return { outcome: 'retry' };
  if (error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500) {
    return { outcome: 'retry' };
  }
  return { outcome: 'conflict', code: error.code, message: error.message };
}

/** Drains FIFO, stopping at the first retryable outage and retaining audit conflicts. */
export async function drainOperationIntents(
  queue: OperationIntentQueue,
  submit: (intent: OperationIntent) => Promise<OperationIntentSubmitResult>,
  now: () => Date = () => new Date(),
): Promise<OperationIntentQueue> {
  let working = queue;
  for (const entry of queue.records) {
    if (entry.status === 'conflict') continue;
    const current = working.records.find((candidate) => candidate.intent.actionId === entry.intent.actionId);
    if (!current || current.status === 'conflict') continue;
    const result = await submit(current.intent);
    if (result.outcome === 'retry') break;
    if (result.outcome === 'confirmed') {
      working = confirmOperationIntent(working, current.intent.actionId);
      continue;
    }
    working = recordPermanentIntentConflict(working, current.intent.actionId, {
      code: result.code,
      message: result.message,
      recordedAt: now().toISOString(),
    });
  }
  return working;
}
