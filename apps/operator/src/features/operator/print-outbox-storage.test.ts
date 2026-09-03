import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardOrder } from './board';
import {
  enqueuePrintJob,
  recordPrintAttempt,
  recordPrintSuccess,
  type PrintOutbox,
  type PrintScope,
} from './print-outbox';
import {
  loadPrintOutbox,
  purgeLegacyPrintOutbox,
  savePrintOutbox,
  wipePrintOutboxes,
  type PrintIndexStorage,
  type PrintSecureStorage,
} from './print-outbox-storage';

const BRAND_A: PrintScope = { brandId: 'brand-a', locationId: 'l1' };
const BRAND_A_OTHER: PrintScope = { brandId: 'brand-a', locationId: 'l2' };
const BRAND_B: PrintScope = { brandId: 'brand-b', locationId: 'l1' };
const QUEUED_AT = '2026-09-01T00:00:00.000Z';
const NOW = Date.parse(QUEUED_AT) + 1_000;

const order = { id: 'o1', shortCode: '1', guestName: 'Ada Lovelace', status: 'in_progress',
  placedAt: '', updatedAt: '', scheduledFor: null, dailyNumber: 1,
  lines: [{ name: 'Latte', quantity: 1, options: ['Oat'], note: 'Extra hot' }],
  totalCents: 575, note: 'Leave at the window', tenderType: 'square_card' } as BoardOrder;

class MemoryIndex implements PrintIndexStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
  async getAllKeys() { return [...this.values.keys()]; }
}

class MemorySecure implements PrintSecureStorage {
  readonly values = new Map<string, string>();
  /** SecureStore documents a 2048-byte item ceiling; refusing above it here
   *  is what proves the chunking is real rather than incidental. */
  limitBytes = 2_048;
  async getItemAsync(key: string) { return this.values.get(key) ?? null; }
  async setItemAsync(key: string, value: string) {
    if (Buffer.byteLength(value, 'utf8') > this.limitBytes) {
      throw new Error('SecureStore item exceeds the platform limit');
    }
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string) { this.values.delete(key); }
}

function queued(scope: PrintScope, overrides: Partial<BoardOrder> = {}, queuedAt = QUEUED_AT): PrintOutbox {
  return enqueuePrintJob({ jobs: [], printedIds: [] }, scope, {
    locationName: 'Uptown',
    order: { ...order, ...overrides } as BoardOrder,
    queuedAt,
  });
}

describe('print outbox storage', () => {
  it('survives a restart with the index in AsyncStorage and the ticket in SecureStore', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    assert.equal(await savePrintOutbox(index, secure, BRAND_A, queued(BRAND_A), NOW), true);

    const restored = await loadPrintOutbox(index, secure, BRAND_A, NOW);
    assert.equal(restored.jobs.length, 1);
    assert.equal(restored.jobs[0]?.order.guestName, 'Ada Lovelace');
    assert.equal(restored.jobs[0]?.order.totalCents, 575);
  });

  /**
   * The defect: the queue was a plaintext AsyncStorage blob holding the guest
   * name, every line and note, the total and the tender type. Nothing readable
   * without the keychain may carry any of that now.
   */
  it('keeps no guest, line, total or tender in the unencrypted index', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    await savePrintOutbox(index, secure, BRAND_A, queued(BRAND_A), NOW);
    const plaintext = [...index.values.values()].join('\n');
    for (const secret of ['Ada Lovelace', 'Latte', 'Extra hot', '575', 'square_card', 'Leave at the window']) {
      assert.equal(plaintext.includes(secret), false, `the index leaked ${secret}`);
    }
    // The ticket itself is there, in the keychain.
    assert.equal([...secure.values.values()].join('').includes('Ada Lovelace'), true);
  });

  /** The key is (brand, location) now, so neither segment alone can collide. */
  it('isolates scopes that share a brand or share a location', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    await savePrintOutbox(index, secure, BRAND_A, queued(BRAND_A), NOW);
    await savePrintOutbox(index, secure, BRAND_A_OTHER, queued(BRAND_A_OTHER, { id: 'o2' }), NOW);
    await savePrintOutbox(index, secure, BRAND_B, queued(BRAND_B, { id: 'o3' }), NOW);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A, NOW)).jobs.map((job) => job.order.id), ['o1']);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A_OTHER, NOW)).jobs.map((job) => job.order.id), ['o2']);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_B, NOW)).jobs.map((job) => job.order.id), ['o3']);
  });

  it('chunks a ticket that exceeds one SecureStore item', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    const big = queued(BRAND_A, {
      lines: Array.from({ length: 40 }, (_value, position) => ({
        name: `Item ${position}`, quantity: 1, options: ['Oat milk', 'Extra hot'], note: 'No lid',
      })),
    } as Partial<BoardOrder>);
    assert.equal(await savePrintOutbox(index, secure, BRAND_A, big, NOW), true);
    assert.ok(secure.values.size > 1, 'the ticket was stored as a single oversized item');
    const restored = await loadPrintOutbox(index, secure, BRAND_A, NOW);
    assert.equal(restored.jobs[0]?.order.lines.length, 40);
  });

  it('refuses to save a ticket past the chunk ceiling instead of dropping it silently', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    const absurd: PrintOutbox = {
      jobs: [{
        attempts: 0, id: 'l1:o1', locationName: 'Uptown', queuedAt: QUEUED_AT,
        order: { ...order, note: 'x'.repeat(64_000) } as BoardOrder,
      }],
      printedIds: [],
    };
    assert.equal(await savePrintOutbox(index, secure, BRAND_A, absurd, NOW), false);
    assert.equal(index.values.size, 0);
  });

  /** The crash the payloads-then-index order exists for. */
  it('never commits an index naming a ticket that is not stored', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    secure.limitBytes = 1;
    assert.equal(await savePrintOutbox(index, secure, BRAND_A, queued(BRAND_A), NOW), false);
    assert.equal(index.values.size, 0);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A, NOW)).jobs, []);
  });

  it('loses only the job whose payload went missing', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    let outbox = queued(BRAND_A);
    outbox = enqueuePrintJob(outbox, BRAND_A, {
      locationName: 'Uptown', order: { ...order, id: 'o2' } as BoardOrder, queuedAt: QUEUED_AT,
    });
    await savePrintOutbox(index, secure, BRAND_A, outbox, NOW);
    const victim = [...secure.values.keys()].find((key) => key.includes('.o1.'));
    assert.ok(victim);
    secure.values.delete(victim);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A, NOW)).jobs.map((job) => job.order.id), ['o2']);
  });

  it('expires a stale ticket on load rather than serving yesterday\'s guest', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    await savePrintOutbox(index, secure, BRAND_A, queued(BRAND_A), NOW);
    const nextDay = Date.parse('2026-09-02T12:00:00.000Z');
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A, nextDay)).jobs, []);
  });

  it('reclaims the payload of a job that printed', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    const outbox = queued(BRAND_A);
    await savePrintOutbox(index, secure, BRAND_A, outbox, NOW);
    assert.ok(secure.values.size > 0);
    const printed = recordPrintSuccess(recordPrintAttempt(outbox, 'l1:o1'), 'l1:o1');
    await savePrintOutbox(index, secure, BRAND_A, printed, NOW);
    assert.equal(secure.values.size, 0);
    const restored = await loadPrintOutbox(index, secure, BRAND_A, NOW);
    assert.deepEqual(restored.jobs, []);
    assert.deepEqual(restored.printedIds, ['l1:o1']);
  });

  it('rejects a scope whose ids cannot key the store', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    const hostile = { brandId: 'brand-a', locationId: '../brand-b' };
    assert.equal(await savePrintOutbox(index, secure, hostile, queued(BRAND_A), NOW), false);
    assert.deepEqual((await loadPrintOutbox(index, secure, hostile, NOW)).jobs, []);
  });

  it('empties the queue on a corrupt index instead of guessing', async () => {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    index.values.set('platform:operator-print-outbox:v2:brand-a:l1', '{bad');
    assert.deepEqual(await loadPrintOutbox(index, secure, BRAND_A, NOW), { jobs: [], printedIds: [] });
  });
});

describe('wipePrintOutboxes', () => {
  async function seeded() {
    const index = new MemoryIndex();
    const secure = new MemorySecure();
    await savePrintOutbox(index, secure, BRAND_A, queued(BRAND_A), NOW);
    await savePrintOutbox(index, secure, BRAND_A_OTHER, queued(BRAND_A_OTHER, { id: 'o2' }), NOW);
    await savePrintOutbox(index, secure, BRAND_B, queued(BRAND_B, { id: 'o3' }), NOW);
    return { index, secure };
  }

  /** The purge the location-only key used to defeat. */
  it('erases every location of one brand and leaves the others alone', async () => {
    const { index, secure } = await seeded();
    assert.equal(await wipePrintOutboxes(index, secure, 'brand-a'), true);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A, NOW)).jobs, []);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_A_OTHER, NOW)).jobs, []);
    assert.deepEqual((await loadPrintOutbox(index, secure, BRAND_B, NOW)).jobs.map((job) => job.order.id), ['o3']);
    assert.equal([...secure.values.values()].join('').includes('Ada Lovelace'), true);
  });

  it('erases every brand on sign-out, keychain included', async () => {
    const { index, secure } = await seeded();
    assert.equal(await wipePrintOutboxes(index, secure), true);
    assert.equal(index.values.size, 0);
    assert.equal(secure.values.size, 0);
  });

  it('takes the pre-encryption plaintext queue with it', async () => {
    const { index, secure } = await seeded();
    index.values.set('platform:operator-print-outbox:l1', '{"version":1,"jobs":[],"printedIds":[]}');
    await wipePrintOutboxes(index, secure);
    assert.equal(index.values.has('platform:operator-print-outbox:l1'), false);
  });
});

describe('purgeLegacyPrintOutbox', () => {
  it('removes the v1 plaintext blob for one location and nothing else', async () => {
    const index = new MemoryIndex();
    index.values.set('platform:operator-print-outbox:l1', 'plaintext');
    index.values.set('platform:operator-printer:l1', 'preferences');
    await purgeLegacyPrintOutbox(index, 'l1');
    assert.deepEqual([...index.values.keys()], ['platform:operator-printer:l1']);
  });
});
