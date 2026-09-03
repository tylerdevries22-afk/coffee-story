import assert from 'node:assert/strict';
import test from 'node:test';

import { track, type AnalyticsEventContext, type AnalyticsEventEnvelope } from './analytics';
import {
  createAnalyticsQueueStore,
  parseStoredQueue,
  serializeQueue,
  type AnalyticsQueueFile,
  type AnalyticsQueueFiles,
  type QueuedEvent,
} from './queue-store';

const BRAND_ID = 'e627d6c2-6cb9-4368-8543-abd02a5afb7c';

function context(): AnalyticsEventContext {
  return {
    brandId: BRAND_ID,
    surface: 'customer',
    appVersion: '1.0.0',
    sessionHash: 'h1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    consent: { essential: true, behavioral: true, source: 'user', updatedAt: '2026-08-27T18:00:00.000Z' },
  };
}

function event(index: number): AnalyticsEventEnvelope {
  const value = track(context(), {
    clientEventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurredAt: '2026-08-27T18:00:00.000Z',
    eventName: 'screen.viewed',
    properties: { screenKey: 'home' },
  });
  assert.ok(value);
  return value;
}

function queued(index: number, queuedAt = 1_000): QueuedEvent {
  return { event: event(index), queuedAt };
}

/**
 * A disk that can be interrupted. `failMoveAfterWrite` reproduces the one
 * failure the write-then-rename bargain exists for: the staging file is fully
 * durable and the rename never happens.
 */
class MemoryDisk {
  readonly contents = new Map<string, string>();
  supportsMoveSync = true;
  failMoveAfterWrite = false;

  file(name: string): AnalyticsQueueFile {
    const disk = this;
    const base = {
      get exists() { return disk.contents.has(name); },
      text: () => disk.contents.get(name) ?? '',
      create: () => { disk.contents.set(name, disk.contents.get(name) ?? ''); },
      write: (value: string) => { disk.contents.set(name, value); },
      delete: () => { disk.contents.delete(name); },
      move: (destination: unknown) => {
        if (disk.failMoveAfterWrite) throw new Error('process died before the rename');
        const targetName = (destination as { name?: string }).name ?? '';
        disk.contents.set(targetName, disk.contents.get(name) ?? '');
        disk.contents.delete(name);
      },
      name,
    };
    if (!this.supportsMoveSync) return base;
    return Object.assign(base, {
      moveSync: (destination: unknown, moveOptions: { overwrite: boolean }) => {
        assert.equal(moveOptions.overwrite, true);
        if (disk.failMoveAfterWrite) throw new Error('process died before the rename');
        const targetName = (destination as { name?: string }).name ?? '';
        disk.contents.set(targetName, disk.contents.get(name) ?? '');
        disk.contents.delete(name);
      },
    });
  }

  files(): AnalyticsQueueFiles {
    return { target: this.file('queue.json'), temp: this.file('queue.json.tmp') };
  }
}

test('queue store round-trips a queue through the atomic save', async () => {
  const disk = new MemoryDisk();
  const store = createAnalyticsQueueStore(disk.files());
  await store.save([queued(1), queued(2)]);
  const restored = await store.load();
  assert.deepEqual(restored.map((item) => item.event.clientEventId),
    [event(1).clientEventId, event(2).clientEventId]);
  assert.equal(restored[0]?.queuedAt, 1_000);
  // The staging file must not survive a completed save.
  assert.equal(disk.contents.has('queue.json.tmp'), false);
});

test('queue store works on the SDK 54 move that cannot overwrite', async () => {
  const disk = new MemoryDisk();
  disk.supportsMoveSync = false;
  const store = createAnalyticsQueueStore(disk.files());
  await store.save([queued(1)]);
  await store.save([queued(1), queued(2)]);
  assert.equal((await store.load()).length, 2);
});

/**
 * The crash the whole design is for: the save died after the staging file was
 * durable and before it replaced the target. Losing that queue would be the
 * exact bug persistence was added to fix.
 */
test('queue store recovers the staging file when a save died before the rename', async () => {
  const disk = new MemoryDisk();
  const store = createAnalyticsQueueStore(disk.files());
  await store.save([queued(1)]);
  disk.failMoveAfterWrite = true;
  await assert.rejects(() => store.save([queued(1), queued(2)]));
  disk.failMoveAfterWrite = false;
  // The target still holds the older save, so that is what a restart reads.
  assert.equal((await store.load()).length, 1);
  // With the target gone as well, the complete staging file is the newest queue.
  disk.contents.delete('queue.json');
  assert.equal((await store.load()).length, 2);
});

test('queue store starts empty rather than throwing on a first launch', async () => {
  const store = createAnalyticsQueueStore(new MemoryDisk().files());
  assert.deepEqual(await store.load(), []);
});

test('queue store clear removes both the queue and its staging file', async () => {
  const disk = new MemoryDisk();
  const store = createAnalyticsQueueStore(disk.files());
  await store.save([queued(1)]);
  disk.contents.set('queue.json.tmp', 'leftover');
  await store.clear();
  assert.equal(disk.contents.size, 0);
  assert.deepEqual(await store.load(), []);
});

test('parseStoredQueue rejects a file it does not recognise', () => {
  assert.deepEqual(parseStoredQueue(null), []);
  assert.deepEqual(parseStoredQueue('{not json'), []);
  assert.deepEqual(parseStoredQueue(JSON.stringify({ version: 99, events: [] })), []);
  assert.deepEqual(parseStoredQueue(JSON.stringify({ version: 1, events: 'nope' })), []);
});

/**
 * A corrupt record must cost itself and nothing else. Dropping the whole file
 * would hand any single bad event the power to erase a day of telemetry.
 */
test('parseStoredQueue keeps the sound events beside a corrupt one', () => {
  const contents = JSON.stringify({
    version: 1,
    events: [
      queued(1),
      { queuedAt: 'soon', event: event(2) },
      { queuedAt: 1_000, event: { ...event(3), clientEventId: 'not-a-uuid' } },
      { queuedAt: 1_000, event: { ...event(4), eventName: 'invented.event' } },
      null,
      queued(5),
    ],
  });
  const restored = parseStoredQueue(contents);
  assert.deepEqual(restored.map((item) => item.event.clientEventId),
    [event(1).clientEventId, event(5).clientEventId]);
});

test('serializeQueue and parseStoredQueue are inverses', () => {
  const queue = [queued(1, 10), queued(2, 20)];
  assert.deepEqual(parseStoredQueue(serializeQueue(queue)), queue);
});
