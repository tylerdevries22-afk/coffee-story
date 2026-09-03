import {
  INTENT_UUID_PATTERN,
  isOperationIntent,
  type CompleteOperationIntent,
  type OperationIntent,
  type OperationIntentQueue,
  type OperationIntentRecord,
  type PermanentOperationIntentConflict,
} from './operation-intents';

/** Confirms one action while preserving later work that depended on its claim. */
export function confirmOperationIntent(
  queue: OperationIntentQueue,
  actionId: string,
): OperationIntentQueue {
  const target = queue.records.find((entry) => entry.intent.actionId === actionId);
  if (!target) return queue;
  const records = queue.records.flatMap<OperationIntentRecord>((entry) => {
    if (entry.intent.actionId === actionId) return [];
    if (target.intent.kind === 'claim' && entry.intent.kind === 'complete'
      && entry.intent.claimActionId === actionId) {
      return [{ ...entry, intent: { ...entry.intent, claimActionId: null } }];
    }
    return [entry];
  });
  return { ...queue, records };
}

export function createOperationIntentQueue(brandId: string, locationId: string): OperationIntentQueue {
  if (!INTENT_UUID_PATTERN.test(brandId) || !INTENT_UUID_PATTERN.test(locationId)) {
    throw new RangeError('Operation intent scope requires UUID brand and location ids.');
  }
  return { brandId, locationId, records: [] };
}

function assertQueueScope(queue: OperationIntentQueue, intent: OperationIntent): void {
  if (intent.brandId !== queue.brandId || intent.locationId !== queue.locationId) {
    throw new RangeError('Operation intent does not belong to this tenant and location queue.');
  }
}

function validClaimDependency(queue: OperationIntentQueue, intent: CompleteOperationIntent): boolean {
  if (intent.claimActionId === null) return true;
  const dependency = queue.records.find((entry) => entry.intent.actionId === intent.claimActionId);
  return dependency?.status === 'pending'
    && dependency.intent.kind === 'claim'
    && dependency.intent.occurrenceId === intent.occurrenceId;
}

/** Deduplicates retries by caller-supplied action id and appends accepted work FIFO. */
export function enqueueOperationIntent(
  queue: OperationIntentQueue,
  intent: OperationIntent,
): OperationIntentQueue {
  if (!isOperationIntent(intent)) throw new RangeError('Operation intent is malformed.');
  assertQueueScope(queue, intent);
  if (queue.records.some((entry) => entry.intent.actionId === intent.actionId)) return queue;
  if (intent.kind === 'complete' && !validClaimDependency(queue, intent)) {
    throw new RangeError('A dependent completion requires its pending claim first.');
  }
  return { ...queue, records: [...queue.records, { status: 'pending', intent }] };
}

/** Retains a permanent rejection as operator-visible audit state. */
export function recordPermanentIntentConflict(
  queue: OperationIntentQueue,
  actionId: string,
  conflict: PermanentOperationIntentConflict,
): OperationIntentQueue {
  if (!conflict.code.trim() || !conflict.message.trim()
    || !Number.isFinite(Date.parse(conflict.recordedAt))) {
    throw new RangeError('Permanent conflict metadata is invalid.');
  }
  const target = queue.records.find((entry) => entry.intent.actionId === actionId);
  if (!target || target.status === 'conflict') return queue;
  const dependsOnTarget = (entry: OperationIntentRecord) => target.intent.kind === 'claim'
    && entry.intent.kind === 'complete' && entry.intent.claimActionId === actionId;
  return {
    ...queue,
    records: queue.records.map((entry) => entry === target || dependsOnTarget(entry)
      ? { status: 'conflict', intent: entry.intent, conflict }
      : entry),
  };
}

/** Removes one action and completions that directly depend on its claim. */
export function removeOperationIntent(
  queue: OperationIntentQueue,
  actionId: string,
): OperationIntentQueue {
  const records = queue.records.filter((entry) => entry.intent.actionId !== actionId
    && !(entry.intent.kind === 'complete' && entry.intent.claimActionId === actionId));
  return records.length === queue.records.length ? queue : { ...queue, records };
}
