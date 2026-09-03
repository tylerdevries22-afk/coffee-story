import {
  ANALYTICS_EVENT_NAMES,
  validateAnalyticsEvent,
  type AnalyticsEventEnvelope,
} from './analytics';

/**
 * Durable backing for the analytics queue.
 *
 * The queue was bounded but purely in memory, so every event buffered while a
 * device was offline died with the process -- and the events that matter most
 * are exactly the ones queued during the outage nobody was watching.
 *
 * The save is write-then-rename, the same bargain `portal-store.ts` already
 * makes for the demo portal: a mid-write failure (disk pressure, a protected
 * data class, process death) must never be able to leave a truncated queue
 * where a complete one used to be. That algorithm lives here rather than in
 * each app so there is one copy of it, and the apps pass in their own
 * expo-file-system handles -- which is also how this package keeps zero
 * runtime dependencies and stays reachable from `node:test`.
 */

const QUEUE_FILE_VERSION = 1;

export type QueuedEvent = Readonly<{ event: AnalyticsEventEnvelope; queuedAt: number }>;

/**
 * One file, in the shape expo-file-system's `File` already has, so an app hands
 * `new File(Paths.document, ...)` straight in.
 *
 * Method syntax and an `unknown` destination are both deliberate: expo's
 * `move` accepts `File | Directory`, and only bivariant parameter checking
 * against a wider type lets a structural port accept it without this package
 * taking a dependency on expo to name those classes.
 */
export type AnalyticsQueueFile = {
  readonly exists: boolean;
  text(): Promise<string> | string;
  create(options: { intermediates: boolean }): void;
  write(contents: string): void;
  delete(): void;
  move(destination: unknown): Promise<void> | void;
};

export type AnalyticsQueueFiles = Readonly<{
  target: AnalyticsQueueFile;
  /** Staging file for the rename; a leftover copy is a recoverable save. */
  temp: AnalyticsQueueFile;
}>;

export type AnalyticsQueueStore = Readonly<{
  load: () => Promise<readonly QueuedEvent[]>;
  save: (queue: readonly QueuedEvent[]) => Promise<void>;
  clear: () => Promise<void>;
}>;

/**
 * expo-file-system renamed its synchronous relocation between SDK versions:
 * SDK 57 exposes `moveSync(destination, { overwrite })`, while the SDK 54 build
 * both Expo apps pin offers only `move(destination)`, which refuses an existing
 * target. Probing for the newer method keeps one implementation valid in both.
 */
type AtomicMove = { moveSync(destination: unknown, options: { overwrite: boolean }): void };

async function readText(files: AnalyticsQueueFiles): Promise<string | null> {
  if (files.target.exists) {
    try {
      return await files.target.text();
    } catch {
      // fall through to the staging file below
    }
  }
  // A save that died between "data durable" and "rename" leaves a complete
  // staging file and a missing or unusable target. Recovering it turns what
  // would have been total loss of the buffered queue into a no-op.
  if (files.temp.exists) {
    try {
      return await files.temp.text();
    } catch {
      return null;
    }
  }
  return null;
}

async function writeText(files: AnalyticsQueueFiles, contents: string): Promise<void> {
  const { target, temp } = files;
  if (temp.exists) temp.delete();
  temp.create({ intermediates: true });
  temp.write(contents);
  // Looked up rather than type-guarded: a `file is File & AtomicMove` predicate
  // narrows the negative branch to `never` under SDK 57, where File already
  // declares moveSync.
  const moveSync = (temp as Partial<AtomicMove>).moveSync;
  if (typeof moveSync === 'function') {
    moveSync.call(temp, target, { overwrite: true });
    return;
  }
  // Without an overwriting rename the target has to go first. The staging file
  // is already fully written at this point, and the read above prefers a
  // leftover staging file over a missing target, so a failure between these two
  // calls still recovers the newest queue on the next launch.
  if (target.exists) target.delete();
  await temp.move(target);
}

function restoredEvent(entry: unknown): QueuedEvent | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const candidate = entry as { queuedAt?: unknown; event?: unknown };
  if (typeof candidate.queuedAt !== 'number' || !Number.isFinite(candidate.queuedAt)) return null;
  if (typeof candidate.event !== 'object' || candidate.event === null) return null;
  const envelope = candidate.event as AnalyticsEventEnvelope;
  if (!ANALYTICS_EVENT_NAMES.includes(envelope.eventName)) return null;
  try {
    return Object.freeze({ event: validateAnalyticsEvent(envelope), queuedAt: candidate.queuedAt });
  } catch {
    // One corrupt event must not cost the rest of the queue. The transport
    // already drops a rejected batch for the same reason: a single bad record
    // may not permanently block later telemetry.
    return null;
  }
}

/** Parses a persisted queue, keeping every event that still validates. */
export function parseStoredQueue(contents: string | null): readonly QueuedEvent[] {
  if (!contents) return [];
  let parsed: { version?: unknown; events?: unknown };
  try {
    parsed = JSON.parse(contents) as { version?: unknown; events?: unknown };
  } catch {
    return [];
  }
  if (parsed.version !== QUEUE_FILE_VERSION || !Array.isArray(parsed.events)) return [];
  const restored: QueuedEvent[] = [];
  for (const entry of parsed.events) {
    const queued = restoredEvent(entry);
    if (queued) restored.push(queued);
  }
  return restored;
}

export function serializeQueue(queue: readonly QueuedEvent[]): string {
  return JSON.stringify({ version: QUEUE_FILE_VERSION, events: queue });
}

/** Binds the atomic save and the validating load to one pair of files. */
export function createAnalyticsQueueStore(files: AnalyticsQueueFiles): AnalyticsQueueStore {
  return Object.freeze({
    load: async () => parseStoredQueue(await readText(files)),
    save: async (queue) => {
      // An empty queue is stored, not deleted: "nothing buffered" is a fact
      // worth surviving a restart, and deleting would resurrect whatever the
      // previous file held if the next write failed.
      await writeText(files, serializeQueue(queue));
    },
    clear: async () => {
      if (files.temp.exists) files.temp.delete();
      if (files.target.exists) files.target.delete();
    },
  });
}
