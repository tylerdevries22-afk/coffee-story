import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OPERATION_INTENT_VERSION,
  createOperationIntentQueue,
  enqueueOperationIntent,
  recordPermanentIntentConflict,
  removeOperationIntent,
  type ClaimOperationIntent,
  type CompleteOperationIntent,
  type OperationIntentQueue,
} from '@platform/offline';
import {
  loadOperationIntents,
  removeStoredOperationIntent,
  saveOperationIntents,
  type OperationIntentIndexStorage,
  type OperationIntentSecureStorage,
} from './persistent-intents';

const BRAND_A = '00000000-0000-4000-8000-000000000001';
const BRAND_B = '00000000-0000-4000-8000-000000000002';
const LOCATION_A = '00000000-0000-4000-8000-000000000011';
const LOCATION_B = '00000000-0000-4000-8000-000000000012';
const OCCURRENCE = '00000000-0000-4000-8000-000000000021';
const CLAIM_ID = '00000000-0000-4000-8000-000000000031';
const COMPLETE_ID = '00000000-0000-4000-8000-000000000032';

class MemoryIndexStorage implements OperationIntentIndexStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('index unavailable');
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('index unavailable');
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (this.failWrites) throw new Error('index unavailable');
    this.values.delete(key);
  }
}

class MemorySecureStorage implements OperationIntentSecureStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async getItemAsync(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('secure storage unavailable');
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('secure storage unavailable');
    this.values.set(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    if (this.failWrites) throw new Error('secure storage unavailable');
    this.values.delete(key);
  }
}

function claim(overrides: Partial<ClaimOperationIntent> = {}): ClaimOperationIntent {
  return {
    version: OPERATION_INTENT_VERSION,
    kind: 'claim',
    actionId: CLAIM_ID,
    brandId: BRAND_A,
    locationId: LOCATION_A,
    occurrenceId: OCCURRENCE,
    createdAt: '2026-08-28T10:00:00.000Z',
    ...overrides,
  };
}

function complete(overrides: Partial<CompleteOperationIntent> = {}): CompleteOperationIntent {
  return {
    version: OPERATION_INTENT_VERSION,
    kind: 'complete',
    actionId: COMPLETE_ID,
    brandId: BRAND_A,
    locationId: LOCATION_A,
    occurrenceId: OCCURRENCE,
    createdAt: '2026-08-28T10:01:00.000Z',
    claimActionId: CLAIM_ID,
    responses: { completed: true },
    note: '',
    issues: [],
    ...overrides,
  };
}

function twoIntentQueue(
  brandId = BRAND_A,
  locationId = LOCATION_A,
): OperationIntentQueue {
  let queue = createOperationIntentQueue(brandId, locationId);
  queue = enqueueOperationIntent(queue, claim({ brandId, locationId }));
  return enqueueOperationIntent(queue, complete({ brandId, locationId }));
}

function onlyValue(map: ReadonlyMap<string, string>): string {
  const value = [...map.values()][0];
  if (value === undefined) throw new Error('Expected one stored value.');
  return value;
}

describe('saveOperationIntents and loadOperationIntents', () => {
  it('survives restart with FIFO in AsyncStorage and payloads only in SecureStore', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    const queue = twoIntentQueue();

    assert.equal(await saveOperationIntents(index, secure, queue), true);
    assert.equal(index.values.size, 1);
    assert.equal(secure.values.size, 2);
    const storedIndex = onlyValue(index.values);
    assert.match(storedIndex, new RegExp(CLAIM_ID));
    assert.match(storedIndex, new RegExp(COMPLETE_ID));
    assert.doesNotMatch(storedIndex, /responses|occurrenceId|createdAt/);

    const restarted = await loadOperationIntents(index, secure, BRAND_A, LOCATION_A);
    assert.deepEqual(restarted, queue);
    assert.deepEqual(restarted.records.map((entry) => entry.intent.actionId), [CLAIM_ID, COMPLETE_ID]);
  });

  it('keeps identical action ids isolated across tenants and locations', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    const scopes = [
      twoIntentQueue(BRAND_A, LOCATION_A),
      twoIntentQueue(BRAND_A, LOCATION_B),
      twoIntentQueue(BRAND_B, LOCATION_A),
    ];
    for (const queue of scopes) assert.equal(await saveOperationIntents(index, secure, queue), true);

    assert.equal(index.values.size, 3);
    assert.equal(secure.values.size, 6);
    for (const queue of scopes) {
      assert.deepEqual(
        await loadOperationIntents(index, secure, queue.brandId, queue.locationId),
        queue,
      );
    }
  });

  it('persists permanent conflict state across restart', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    const queue = recordPermanentIntentConflict(twoIntentQueue(), CLAIM_ID, {
      code: 'claim_taken',
      message: 'Another worker claimed this occurrence.',
      recordedAt: '2026-08-28T10:05:00.000Z',
    });

    assert.equal(await saveOperationIntents(index, secure, queue), true);
    const restarted = await loadOperationIntents(index, secure, BRAND_A, LOCATION_A);
    assert.deepEqual(restarted.records.map((entry) => entry.status), ['conflict', 'conflict']);
  });

  it('cleans payloads removed from a later committed index', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    const queue = twoIntentQueue();
    await saveOperationIntents(index, secure, queue);

    const withoutCompletion = removeOperationIntent(queue, COMPLETE_ID);
    assert.equal(await saveOperationIntents(index, secure, withoutCompletion), true);
    assert.equal(secure.values.size, 1);
    assert.deepEqual(await loadOperationIntents(index, secure, BRAND_A, LOCATION_A), withoutCompletion);
  });
});

describe('corrupt and unavailable persistence', () => {
  it('fails closed on malformed, mismatched, duplicate, or old indexes', async () => {
    const invalidIndexes = [
      '{bad',
      JSON.stringify({ version: 2, actionIds: [CLAIM_ID] }),
      JSON.stringify({ version: 1, actionIds: ['not-a-uuid'] }),
      JSON.stringify({ version: 1, actionIds: [CLAIM_ID, CLAIM_ID] }),
    ];
    for (const stored of invalidIndexes) {
      const index = new MemoryIndexStorage();
      const secureForIndex = new MemorySecureStorage();
      await saveOperationIntents(index, secureForIndex, twoIntentQueue());
      const [scopeKey] = index.values.keys();
      if (!scopeKey) throw new Error('Expected an AsyncStorage index.');
      index.values.set(scopeKey, stored);
      assert.deepEqual(
        (await loadOperationIntents(index, secureForIndex, BRAND_A, LOCATION_A)).records,
        [],
      );
    }
  });

  it('fails closed when any SecureStore payload is missing, corrupt, or cross-scoped', async () => {
    const corruptors: readonly ((value: string) => string | null)[] = [
      () => null,
      () => '{bad',
      (value) => {
        const parsed = JSON.parse(value) as { status: string; intent: ClaimOperationIntent };
        return JSON.stringify({ ...parsed, status: 'unknown' });
      },
      (value) => {
        const parsed = JSON.parse(value) as { status: string; intent: ClaimOperationIntent };
        return JSON.stringify({ ...parsed, intent: { ...parsed.intent, version: 2 } });
      },
      (value) => {
        const parsed = JSON.parse(value) as { status: string; intent: ClaimOperationIntent };
        return JSON.stringify({ ...parsed, intent: { ...parsed.intent, brandId: BRAND_B } });
      },
    ];
    for (const corrupt of corruptors) {
      const index = new MemoryIndexStorage();
      const secure = new MemorySecureStorage();
      await saveOperationIntents(index, secure, twoIntentQueue());
      const [firstKey] = secure.values.keys();
      if (!firstKey) throw new Error('Expected a SecureStore payload.');
      const changed = corrupt(secure.values.get(firstKey) ?? '');
      if (changed === null) secure.values.delete(firstKey);
      else secure.values.set(firstKey, changed);
      assert.deepEqual(
        (await loadOperationIntents(index, secure, BRAND_A, LOCATION_A)).records,
        [],
      );
    }
  });

  it('returns safe results instead of throwing when either store is unavailable', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    index.failWrites = true;
    assert.equal(await saveOperationIntents(index, secure, twoIntentQueue()), false);
    index.failWrites = false;
    secure.failWrites = true;
    assert.equal(await saveOperationIntents(index, secure, twoIntentQueue()), false);
    secure.failWrites = false;
    index.failReads = true;
    assert.deepEqual((await loadOperationIntents(index, secure, BRAND_A, LOCATION_A)).records, []);
    index.failReads = false;
    const readableIndex = new MemoryIndexStorage();
    const unavailableSecure = new MemorySecureStorage();
    await saveOperationIntents(readableIndex, unavailableSecure, twoIntentQueue());
    unavailableSecure.failReads = true;
    assert.deepEqual(
      (await loadOperationIntents(readableIndex, unavailableSecure, BRAND_A, LOCATION_A)).records,
      [],
    );
  });

  it('fails closed when persisted FIFO puts completion before its claim', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    await saveOperationIntents(index, secure, twoIntentQueue());
    const [scopeKey] = index.values.keys();
    if (!scopeKey) throw new Error('Expected an AsyncStorage index.');
    index.values.set(scopeKey, JSON.stringify({
      version: OPERATION_INTENT_VERSION,
      actionIds: [COMPLETE_ID, CLAIM_ID],
    }));

    assert.deepEqual(
      (await loadOperationIntents(index, secure, BRAND_A, LOCATION_A)).records,
      [],
    );
  });
});

describe('removeStoredOperationIntent', () => {
  it('removes a claim and dependent completion after restart without touching another scope', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    const own = twoIntentQueue();
    const other = twoIntentQueue(BRAND_B, LOCATION_A);
    await saveOperationIntents(index, secure, own);
    await saveOperationIntents(index, secure, other);

    assert.equal(await removeStoredOperationIntent(
      index, secure, BRAND_A, LOCATION_A, CLAIM_ID,
    ), true);
    assert.deepEqual((await loadOperationIntents(index, secure, BRAND_A, LOCATION_A)).records, []);
    assert.deepEqual(await loadOperationIntents(index, secure, BRAND_B, LOCATION_A), other);
  });

  it('reports deletion failure without exposing or changing another scope', async () => {
    const index = new MemoryIndexStorage();
    const secure = new MemorySecureStorage();
    await saveOperationIntents(index, secure, twoIntentQueue());
    secure.failWrites = true;

    assert.equal(await removeStoredOperationIntent(
      index, secure, BRAND_A, LOCATION_A, CLAIM_ID,
    ), false);
  });
});
