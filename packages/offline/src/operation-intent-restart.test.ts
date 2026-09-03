import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPERATION_INTENT_VERSION,
  createOperationIntentQueue,
  enqueueOperationIntent,
  isOperationIntent,
  recordPermanentIntentConflict,
  type OperationIntent,
  type OperationIntentQueue,
  type PermanentOperationIntentConflict,
} from './index';

/**
 * The two reasons this queue exists at all.
 *
 * A worker's tablet loses the network mid-shift and the app is killed -- by the
 * OS reclaiming memory, by a dead battery, by a crash. Whatever was queued has
 * to come back in the same order, with a completion still tied to the claim it
 * depended on, and a retry of an action already on disk must not send twice.
 */
const BRAND_ID = '10000000-0000-4000-8000-000000000001';
const LOCATION_ID = '10000000-0000-4000-8000-000000000002';
const OCCURRENCE_ID = '10000000-0000-4000-8000-000000000003';
const CLAIM_ID = '10000000-0000-4000-8000-000000000004';
const COMPLETE_ID = '10000000-0000-4000-8000-000000000005';
const ISSUE_ID = '10000000-0000-4000-8000-000000000006';

const CLAIM: OperationIntent = {
  version: OPERATION_INTENT_VERSION, kind: 'claim', actionId: CLAIM_ID,
  brandId: BRAND_ID, locationId: LOCATION_ID, occurrenceId: OCCURRENCE_ID,
  createdAt: '2026-08-27T12:00:00.000Z',
};

const COMPLETE: OperationIntent = {
  version: OPERATION_INTENT_VERSION, kind: 'complete', actionId: COMPLETE_ID,
  brandId: BRAND_ID, locationId: LOCATION_ID, occurrenceId: OCCURRENCE_ID,
  createdAt: '2026-08-27T12:01:00.000Z', claimActionId: CLAIM_ID,
  responses: { clean: true }, note: 'Wiped down.', issues: [],
};

const REPORT: OperationIntent = {
  version: OPERATION_INTENT_VERSION, kind: 'report_issue', actionId: ISSUE_ID,
  brandId: BRAND_ID, locationId: LOCATION_ID, occurrenceId: OCCURRENCE_ID,
  createdAt: '2026-08-27T12:02:00.000Z', category: 'equipment',
  severity: 'high', description: 'Grinder jammed.', stepKey: null,
};

type StoredRecord = { status?: unknown; intent?: unknown; conflict?: unknown };
type Persisted = { index: readonly string[]; payloads: ReadonlyMap<string, string> };

/** One JSON payload per action plus a FIFO index, as the device store keeps it. */
function persist(queue: OperationIntentQueue): Persisted {
  const payloads = new Map<string, string>();
  for (const entry of queue.records) payloads.set(entry.intent.actionId, JSON.stringify(entry));
  return { index: queue.records.map((entry) => entry.intent.actionId), payloads };
}

function isConflict(value: unknown): value is PermanentOperationIntentConflict {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
    && typeof candidate.recordedAt === 'string';
}

/**
 * A relaunch: read the index, rehydrate each payload through the runtime
 * boundary, then re-apply audit state. Anything malformed empties the queue
 * rather than hydrating half an action.
 */
function restart(saved: Persisted): OperationIntentQueue {
  const empty = createOperationIntentQueue(BRAND_ID, LOCATION_ID);
  const parsed: StoredRecord[] = [];
  for (const actionId of saved.index) {
    const raw = saved.payloads.get(actionId);
    if (raw === undefined) return empty;
    try {
      parsed.push(JSON.parse(raw) as StoredRecord);
    } catch {
      return empty;
    }
  }
  let queue = empty;
  for (const entry of parsed) {
    if (!isOperationIntent(entry.intent)) return empty;
    queue = enqueueOperationIntent(queue, entry.intent);
  }
  for (const entry of parsed) {
    if (entry.status !== 'conflict' || !isConflict(entry.conflict)) continue;
    if (!isOperationIntent(entry.intent)) return empty;
    queue = recordPermanentIntentConflict(queue, entry.intent.actionId, entry.conflict);
  }
  return queue;
}

function queued(...intents: readonly OperationIntent[]): OperationIntentQueue {
  return intents.reduce(enqueueOperationIntent, createOperationIntentQueue(BRAND_ID, LOCATION_ID));
}

test('a killed app comes back with the same queue, order and claim dependency', () => {
  const before = queued(CLAIM, COMPLETE, REPORT);
  const after = restart(persist(before));
  assert.deepEqual(after, before);
  assert.deepEqual(after.records.map((entry) => entry.intent.actionId), [CLAIM_ID, COMPLETE_ID, ISSUE_ID]);
  const completion = after.records[1]?.intent;
  assert.equal(completion?.kind, 'complete');
  // The claim must still be ahead of the completion that depended on it, or the
  // drain would send a completion for work this device never claimed.
  if (completion?.kind === 'complete') assert.equal(completion.claimActionId, CLAIM_ID);
});

test('a permanent conflict is still audit state after a restart', () => {
  const conflict = {
    code: 'already_claimed', message: 'Claimed by another worker.',
    recordedAt: '2026-08-27T12:03:00.000Z',
  };
  const before = recordPermanentIntentConflict(queued(CLAIM, REPORT), ISSUE_ID, conflict);
  const after = restart(persist(before));
  assert.deepEqual(after, before);
  assert.deepEqual(after.records.map((entry) => entry.status), ['pending', 'conflict']);
});

test('a payload the process died halfway through writing empties the queue', () => {
  const saved = persist(queued(CLAIM, COMPLETE));
  const torn = new Map(saved.payloads);
  const whole = torn.get(COMPLETE_ID);
  assert.ok(whole);
  torn.set(COMPLETE_ID, whole.slice(0, Math.floor(whole.length / 2)));
  // Better to lose two queued actions than to send a completion assembled from
  // half a JSON object, which is a write against real shift data.
  assert.deepEqual(restart({ index: saved.index, payloads: torn }).records, []);
});

test('an obsolete stored version is refused rather than replayed', () => {
  const saved = persist(queued(CLAIM));
  const stale = new Map(saved.payloads);
  stale.set(CLAIM_ID, JSON.stringify({
    status: 'pending', intent: { ...CLAIM, version: OPERATION_INTENT_VERSION + 1 },
  }));
  assert.deepEqual(restart({ index: saved.index, payloads: stale }).records, []);
});

test('a retry of an action already queued is dropped on its actionId', () => {
  const once = queued(CLAIM);
  const twice = enqueueOperationIntent(once, CLAIM);
  // Same queue object, not just an equal one: nothing was appended.
  assert.equal(twice, once);
  assert.equal(twice.records.length, 1);
});

test('the first write of an actionId wins, so a mutated retry cannot overwrite it', () => {
  const first = queued(REPORT);
  const mutated: OperationIntent = { ...REPORT, description: 'Grinder is fine after all.' } as OperationIntent;
  const second = enqueueOperationIntent(first, mutated);
  assert.equal(second, first);
  const stored = second.records[0]?.intent;
  assert.equal(stored?.kind, 'report_issue');
  if (stored?.kind === 'report_issue') assert.equal(stored.description, 'Grinder jammed.');
});

test('a retry issued after a restart still dedupes against the rehydrated queue', () => {
  // The double-send this guards: the queue is restored from disk, and the screen
  // that was mid-submit when the app died retries the same action id.
  const restored = restart(persist(queued(CLAIM, COMPLETE)));
  const retried = enqueueOperationIntent(restored, COMPLETE);
  assert.equal(retried, restored);
  assert.equal(retried.records.length, 2);
});
