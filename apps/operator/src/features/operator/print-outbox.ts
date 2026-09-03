import type { BoardOrder } from './board';

/**
 * The local print queue's model: what a job is, how the queue advances, and
 * what it may hold. Storage lives in `print-outbox-storage.ts`; nothing here
 * touches AsyncStorage or SecureStore, so `node:test` reaches all of it.
 */

/** Compatible with the subset of AsyncStorage the queue index and preferences use. */
export type PrintStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type PrintJob = {
  attempts: number;
  id: string;
  locationName: string;
  order: BoardOrder;
  queuedAt: string;
};

export type PrintOutbox = {
  jobs: PrintJob[];
  printedIds: string[];
};

/** Where a job and its dedupe marker live. Both segments must key the storage. */
export type PrintScope = Readonly<{ brandId: string; locationId: string }>;

export const MAX_JOBS = 100;
export const MAX_PRINTED_IDS = 500;
export const MAX_PRINT_ATTEMPTS = 2;

/**
 * One long trading day. A kitchen ticket that has not printed by the end of a
 * shift is never going to be useful, and the job carries the guest's name and
 * their whole order -- so holding it past its usefulness is pure exposure with
 * no operational upside. Before this the queue had no age bound at all.
 */
export const MAX_JOB_AGE_MS = 12 * 60 * 60 * 1_000;

/**
 * SecureStore documents a 2048-byte ceiling per item and warns above it, so a
 * job is stored in chunks. The chunk stays well under the ceiling because the
 * limit counts UTF-8 bytes and a guest name or an item note may be well
 * outside ASCII.
 */
export const SECURE_CHUNK_BYTES = 1_500;

/**
 * The ceiling on one ticket, about 36 KB -- far past any real order, so the
 * refusal below is a guard rather than a routine outcome. A job that does not
 * fit is reported to staff, never dropped in silence.
 */
export const MAX_PAYLOAD_CHUNKS = 24;

/** UTF-8 length without assuming a TextEncoder exists on the JS engine. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Splits on code points, never on a byte offset: cutting a multi-byte
 * character in half would corrupt a guest name that happens to carry an
 * accent, and the two halves would reassemble into mojibake on a ticket.
 */
export function chunkByUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let size = 0;
  for (const character of value) {
    const width = utf8ByteLength(character);
    if (size + width > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      size = 0;
    }
    current += character;
    size += width;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
}

export function printJobPayload(job: PrintJob): string {
  return JSON.stringify(job);
}

/** False when a ticket is too large for the encrypted store to hold. */
export function printJobFits(job: PrintJob): boolean {
  return utf8ByteLength(printJobPayload(job)) <= SECURE_CHUNK_BYTES * MAX_PAYLOAD_CHUNKS;
}

export function printJobId(scope: PrintScope, orderId: string): string {
  return `${scope.locationId}:${orderId}`;
}

/** The job a queued order would become, for a size check before enqueueing it. */
export function candidatePrintJob(
  scope: PrintScope,
  input: { locationName: string; order: BoardOrder; queuedAt: string },
): PrintJob {
  return {
    attempts: 0,
    id: printJobId(scope, input.order.id),
    locationName: input.locationName,
    order: input.order,
    queuedAt: input.queuedAt,
  };
}

/** Drops jobs past their age bound; the same rule runs on load and on save. */
export function expirePrintJobs(outbox: PrintOutbox, now: number): PrintOutbox {
  const cutoff = now - MAX_JOB_AGE_MS;
  const jobs = outbox.jobs.filter((job) => {
    const queuedAt = Date.parse(job.queuedAt);
    // An unparseable timestamp is treated as expired: it cannot be shown to
    // have arrived inside the window, and the record holds a guest's order.
    return Number.isFinite(queuedAt) && queuedAt >= cutoff;
  });
  return jobs.length === outbox.jobs.length ? outbox : { ...outbox, jobs };
}

export function enqueuePrintJob(
  outbox: PrintOutbox,
  scope: PrintScope,
  input: { locationName: string; order: BoardOrder; queuedAt: string },
): PrintOutbox {
  const job = candidatePrintJob(scope, input);
  if (outbox.printedIds.includes(job.id) || outbox.jobs.some((queued) => queued.id === job.id)) {
    return outbox;
  }
  if (outbox.jobs.length >= MAX_JOBS || !printJobFits(job)) return outbox;
  return { ...outbox, jobs: [...outbox.jobs, job] };
}

export function nextPrintJob(outbox: PrintOutbox): PrintJob | null {
  return outbox.jobs.find((job) => job.attempts < MAX_PRINT_ATTEMPTS) ?? null;
}

export function recordPrintAttempt(outbox: PrintOutbox, id: string): PrintOutbox {
  return { ...outbox, jobs: outbox.jobs.map((job) => (
    job.id === id ? { ...job, attempts: job.attempts + 1 } : job
  )) };
}

export function recordPrintSuccess(outbox: PrintOutbox, id: string): PrintOutbox {
  return {
    jobs: outbox.jobs.filter((job) => job.id !== id),
    printedIds: [...outbox.printedIds.filter((printed) => printed !== id), id].slice(-MAX_PRINTED_IDS),
  };
}
