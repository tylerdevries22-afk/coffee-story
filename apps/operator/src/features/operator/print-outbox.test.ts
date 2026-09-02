import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardOrder } from './board';
import {
  enqueuePrintJob, loadPrintOutbox, nextPrintJob, recordPrintAttempt,
  recordPrintSuccess, savePrintOutbox, type PrintStorage,
} from './print-outbox';

class MemoryStorage implements PrintStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const order = { id: 'o1', shortCode: '1', guestName: 'Guest', status: 'in_progress',
  placedAt: '', updatedAt: '', scheduledFor: null, dailyNumber: 1, lines: [], totalCents: 100,
  note: '', tenderType: 'square_card' } as BoardOrder;

describe('print outbox', () => {
  it('persists, deduplicates, retries twice, and records completion', async () => {
    const storage = new MemoryStorage();
    const input = { locationId: 'l1', locationName: 'Uptown', order, queuedAt: '2026-09-01T00:00:00Z' };
    let outbox = enqueuePrintJob({ jobs: [], printedIds: [] }, input);
    assert.equal(enqueuePrintJob(outbox, input), outbox);
    assert.equal(await savePrintOutbox(storage, 'l1', outbox), true);
    outbox = await loadPrintOutbox(storage, 'l1');
    assert.equal(nextPrintJob(outbox)?.id, 'l1:o1');
    outbox = recordPrintAttempt(recordPrintAttempt(outbox, 'l1:o1'), 'l1:o1');
    assert.equal(nextPrintJob(outbox), null);
    outbox = recordPrintSuccess(outbox, 'l1:o1');
    assert.deepEqual(outbox, { jobs: [], printedIds: ['l1:o1'] });
    assert.equal(enqueuePrintJob(outbox, input), outbox);
  });

  it('fails closed on corrupt storage', async () => {
    const storage = new MemoryStorage();
    storage.values.set('platform:operator-print-outbox:l1', '{bad');
    assert.deepEqual(await loadPrintOutbox(storage, 'l1'), { jobs: [], printedIds: [] });
  });

  it('rejects a corrupt nested receipt snapshot', async () => {
    const storage = new MemoryStorage();
    storage.values.set('platform:operator-print-outbox:l1', JSON.stringify({
      version: 1,
      printedIds: [],
      jobs: [{
        attempts: 0,
        id: 'l1:o1',
        locationName: 'Uptown',
        order: { ...order, lines: [{ name: 'Latte', quantity: 1, options: [7] }] },
        queuedAt: '2026-09-01T00:00:00Z',
      }],
    }));
    assert.deepEqual(await loadPrintOutbox(storage, 'l1'), { jobs: [], printedIds: [] });
  });

  it('never discards an older unprinted job when the queue is full', () => {
    let outbox = { jobs: [], printedIds: [] } as ReturnType<typeof enqueuePrintJob>;
    for (let index = 0; index <= 100; index += 1) {
      outbox = enqueuePrintJob(outbox, {
        locationId: 'l1',
        locationName: 'Uptown',
        order: { ...order, id: `o${index}` },
        queuedAt: '2026-09-01T00:00:00Z',
      });
    }
    assert.equal(outbox.jobs.length, 100);
    assert.equal(outbox.jobs[0]?.id, 'l1:o0');
    assert.equal(outbox.jobs.at(-1)?.id, 'l1:o99');
  });
});
