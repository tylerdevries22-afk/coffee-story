import {
  OPERATION_INTENT_VERSION,
  createOperationIntentQueue,
  isOperationIntent,
  removeOperationIntent,
  type OperationIntentQueue,
  type OperationIntentRecord,
  type PermanentOperationIntentConflict,
} from '@platform/offline';

/** Compatible with the subset of AsyncStorage used for the ordered index. */
export type OperationIntentIndexStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** Compatible with Expo SecureStore; each key contains one intent record. */
export type OperationIntentSecureStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

type StoredIndex = { version: typeof OPERATION_INTENT_VERSION; actionIds: string[] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function indexKey(brandId: string, locationId: string): string {
  return `platform:operations:intents:v1:${brandId}:${locationId}`;
}

function payloadKey(brandId: string, locationId: string, actionId: string): string {
  return `platform.operations.intent.v1.${brandId}.${locationId}.${actionId}`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseIndex(value: string | null): StoredIndex | null {
  if (!value) return null;
  try {
    const parsed = objectRecord(JSON.parse(value) as unknown);
    if (!parsed || parsed.version !== OPERATION_INTENT_VERSION || !Array.isArray(parsed.actionIds)) return null;
    const actionIds = parsed.actionIds;
    if (!actionIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) return null;
    if (new Set(actionIds).size !== actionIds.length) return null;
    return { version: OPERATION_INTENT_VERSION, actionIds } as StoredIndex;
  } catch {
    return null;
  }
}

function validConflict(value: unknown): value is PermanentOperationIntentConflict {
  const conflict = objectRecord(value);
  return conflict !== null && typeof conflict.code === 'string' && conflict.code.trim().length > 0
    && typeof conflict.message === 'string' && conflict.message.trim().length > 0
    && typeof conflict.recordedAt === 'string' && Number.isFinite(Date.parse(conflict.recordedAt));
}

function validQueueRecord(entry: OperationIntentRecord): boolean {
  return isOperationIntent(entry.intent)
    && (entry.status === 'pending' || (entry.status === 'conflict' && validConflict(entry.conflict)));
}

function parseRecord(value: string | null): OperationIntentRecord | null {
  if (!value) return null;
  try {
    const parsed = objectRecord(JSON.parse(value) as unknown);
    if (!parsed || !isOperationIntent(parsed.intent)) return null;
    if (parsed.status === 'pending') return { status: 'pending', intent: parsed.intent };
    if (parsed.status === 'conflict' && validConflict(parsed.conflict)) {
      return { status: 'conflict', intent: parsed.intent, conflict: parsed.conflict };
    }
    return null;
  } catch {
    return null;
  }
}

function recordsMatchScope(
  records: readonly OperationIntentRecord[],
  brandId: string,
  locationId: string,
  actionIds: readonly string[],
): boolean {
  return records.every((entry, index) => validQueueRecord(entry)
    && entry.intent.brandId === brandId
    && entry.intent.locationId === locationId
    && entry.intent.actionId === actionIds[index]);
}

function dependenciesPrecedeCompletions(records: readonly OperationIntentRecord[]): boolean {
  const priorClaims = new Map<string, string>();
  for (const entry of records) {
    const { intent } = entry;
    if (intent.kind === 'claim') {
      priorClaims.set(intent.actionId, intent.occurrenceId);
    }
    if (intent.kind === 'complete' && intent.claimActionId !== null
      && priorClaims.get(intent.claimActionId) !== intent.occurrenceId) return false;
  }
  return true;
}

/** Loads a single tenant/location queue; any malformed record empties it. */
export async function loadOperationIntents(
  indexStorage: OperationIntentIndexStorage,
  secureStorage: OperationIntentSecureStorage,
  brandId: string,
  locationId: string,
): Promise<OperationIntentQueue> {
  const empty = createOperationIntentQueue(brandId, locationId);
  try {
    const index = parseIndex(await indexStorage.getItem(indexKey(brandId, locationId)));
    if (!index) return empty;
    const payloads = await Promise.all(index.actionIds.map((actionId) =>
      secureStorage.getItemAsync(payloadKey(brandId, locationId, actionId))));
    const records = payloads.map(parseRecord);
    if (records.some((entry) => entry === null)) return empty;
    const validRecords = records.filter((entry): entry is OperationIntentRecord => entry !== null);
    if (!recordsMatchScope(validRecords, brandId, locationId, index.actionIds)
      || !dependenciesPrecedeCompletions(validRecords)) return empty;
    return { brandId, locationId, records: validRecords };
  } catch {
    return empty;
  }
}

async function previousActionIds(
  storage: OperationIntentIndexStorage,
  brandId: string,
  locationId: string,
): Promise<string[]> {
  try {
    return parseIndex(await storage.getItem(indexKey(brandId, locationId)))?.actionIds ?? [];
  } catch {
    return [];
  }
}

/** Writes payloads first, then commits their FIFO AsyncStorage index. */
export async function saveOperationIntents(
  indexStorage: OperationIntentIndexStorage,
  secureStorage: OperationIntentSecureStorage,
  queue: OperationIntentQueue,
): Promise<boolean> {
  try {
    const actionIds = queue.records.map((entry) => entry.intent.actionId);
    if (!recordsMatchScope(queue.records, queue.brandId, queue.locationId, actionIds)
      || new Set(actionIds).size !== actionIds.length
      || !dependenciesPrecedeCompletions(queue.records)) return false;
    const previous = await previousActionIds(indexStorage, queue.brandId, queue.locationId);
    await Promise.all(queue.records.map((entry) => secureStorage.setItemAsync(
      payloadKey(queue.brandId, queue.locationId, entry.intent.actionId),
      JSON.stringify(entry),
    )));
    const key = indexKey(queue.brandId, queue.locationId);
    if (actionIds.length === 0) await indexStorage.removeItem(key);
    else await indexStorage.setItem(key, JSON.stringify({ version: OPERATION_INTENT_VERSION, actionIds }));
    const retained = new Set(actionIds);
    await Promise.all(previous.filter((id) => !retained.has(id)).map((id) =>
      secureStorage.deleteItemAsync(payloadKey(queue.brandId, queue.locationId, id))));
    return true;
  } catch {
    return false;
  }
}

/** Removes an action from only the named scope and persists the result. */
export async function removeStoredOperationIntent(
  indexStorage: OperationIntentIndexStorage,
  secureStorage: OperationIntentSecureStorage,
  brandId: string,
  locationId: string,
  actionId: string,
): Promise<boolean> {
  const queue = await loadOperationIntents(indexStorage, secureStorage, brandId, locationId);
  const next = removeOperationIntent(queue, actionId);
  if (!await saveOperationIntents(indexStorage, secureStorage, next)) return false;
  try {
    await secureStorage.deleteItemAsync(payloadKey(brandId, locationId, actionId));
    return true;
  } catch {
    return false;
  }
}
