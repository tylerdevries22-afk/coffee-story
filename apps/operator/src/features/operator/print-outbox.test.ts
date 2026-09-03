import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardOrder } from './board';
import {
  MAX_JOB_AGE_MS,
  candidatePrintJob,
  chunkByUtf8Bytes,
  enqueuePrintJob,
  expirePrintJobs,
  nextPrintJob,
  printJobFits,
  recordPrintAttempt,
  recordPrintSuccess,
  utf8ByteLength,
  type PrintOutbox,
  type PrintScope,
} from './print-outbox';

const SCOPE: PrintScope = { brandId: 'brand-1', locationId: 'l1' };
const QUEUED_AT = '2026-09-01T00:00:00.000Z';
const NOW = Date.parse(QUEUED_AT) + 1_000;

const order = { id: 'o1', shortCode: '1', guestName: 'Guest', status: 'in_progress',
  placedAt: '', updatedAt: '', scheduledFor: null, dailyNumber: 1, lines: [], totalCents: 100,
  note: '', tenderType: 'square_card' } as BoardOrder;

const empty: PrintOutbox = { jobs: [], printedIds: [] };

describe('print outbox', () => {
  it('deduplicates, retries twice, and records completion', () => {
    const input = { locationName: 'Uptown', order, queuedAt: QUEUED_AT };
    let outbox = enqueuePrintJob(empty, SCOPE, input);
    assert.equal(enqueuePrintJob(outbox, SCOPE, input), outbox);
    assert.equal(nextPrintJob(outbox)?.id, 'l1:o1');
    outbox = recordPrintAttempt(recordPrintAttempt(outbox, 'l1:o1'), 'l1:o1');
    assert.equal(nextPrintJob(outbox), null);
    outbox = recordPrintSuccess(outbox, 'l1:o1');
    assert.deepEqual(outbox, { jobs: [], printedIds: ['l1:o1'] });
    assert.equal(enqueuePrintJob(outbox, SCOPE, input), outbox);
  });

  it('never discards an older unprinted job when the queue is full', () => {
    let outbox = empty;
    for (let index = 0; index <= 100; index += 1) {
      outbox = enqueuePrintJob(outbox, SCOPE, {
        locationName: 'Uptown',
        order: { ...order, id: `o${index}` },
        queuedAt: QUEUED_AT,
      });
    }
    assert.equal(outbox.jobs.length, 100);
    assert.equal(outbox.jobs[0]?.id, 'l1:o0');
    assert.equal(outbox.jobs.at(-1)?.id, 'l1:o99');
  });
});

describe('expirePrintJobs', () => {
  /**
   * Before this the queue had no age bound at all, so a ticket that never
   * printed kept a guest's name and their whole order on the tablet forever.
   */
  it('drops a job past the shift-length age bound and keeps a fresh one', () => {
    const outbox = enqueuePrintJob(
      enqueuePrintJob(empty, SCOPE, { locationName: 'Uptown', order, queuedAt: QUEUED_AT }),
      SCOPE,
      { locationName: 'Uptown', order: { ...order, id: 'o2' }, queuedAt: '2026-09-02T00:00:00.000Z' },
    );
    const later = Date.parse('2026-09-02T00:00:00.000Z') + 1_000;
    assert.equal(later - Date.parse(QUEUED_AT) > MAX_JOB_AGE_MS, true);
    const kept = expirePrintJobs(outbox, later);
    assert.deepEqual(kept.jobs.map((job) => job.id), ['l1:o2']);
  });

  it('treats an unparseable timestamp as expired rather than immortal', () => {
    const outbox: PrintOutbox = {
      jobs: [{ ...candidatePrintJob(SCOPE, { locationName: 'Uptown', order, queuedAt: QUEUED_AT }), queuedAt: 'soon' }],
      printedIds: [],
    };
    assert.deepEqual(expirePrintJobs(outbox, NOW).jobs, []);
  });

  it('returns the same object when nothing expired', () => {
    const outbox = enqueuePrintJob(empty, SCOPE, { locationName: 'Uptown', order, queuedAt: QUEUED_AT });
    assert.equal(expirePrintJobs(outbox, NOW), outbox);
  });
});

describe('payload sizing', () => {
  it('counts UTF-8 bytes rather than code units', () => {
    assert.equal(utf8ByteLength('abc'), 3);
    assert.equal(utf8ByteLength('é'), 2);
    assert.equal(utf8ByteLength('한'), 3);
    assert.equal(utf8ByteLength('🍵'), 4);
  });

  /**
   * A chunk cut on a byte offset would split a multi-byte character in half,
   * and a guest name carrying an accent would reassemble into mojibake on a
   * ticket the kitchen has to read.
   */
  it('splits on code points and rejoins exactly', () => {
    const value = 'héllo 🍵 wörld';
    const chunks = chunkByUtf8Bytes(value, 4);
    assert.equal(chunks.join(''), value);
    for (const chunk of chunks) assert.ok(utf8ByteLength(chunk) <= 4);
  });

  it('emits one empty chunk for an empty value', () => {
    assert.deepEqual(chunkByUtf8Bytes('', 4), ['']);
  });

  it('accepts a realistic ticket and refuses an implausible one', () => {
    const realistic = candidatePrintJob(SCOPE, {
      locationName: 'Uptown',
      order: {
        ...order,
        lines: Array.from({ length: 30 }, (_value, index) => ({
          name: `Item ${index}`, quantity: 2, options: ['Oat milk', 'Extra hot'], note: 'No lid please',
        })),
      } as BoardOrder,
      queuedAt: QUEUED_AT,
    });
    assert.equal(printJobFits(realistic), true);

    const absurd = candidatePrintJob(SCOPE, {
      locationName: 'Uptown',
      order: { ...order, note: 'x'.repeat(64_000) } as BoardOrder,
      queuedAt: QUEUED_AT,
    });
    assert.equal(printJobFits(absurd), false);
  });

  /** Refused at the door, so it can never wedge every later save. */
  it('does not queue a job that cannot be stored', () => {
    const outbox = enqueuePrintJob(empty, SCOPE, {
      locationName: 'Uptown',
      order: { ...order, note: 'x'.repeat(64_000) } as BoardOrder,
      queuedAt: QUEUED_AT,
    });
    assert.equal(outbox, empty);
  });
});
