import type { BoardOrder } from './board';

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

const VERSION = 1;
const MAX_JOBS = 100;
const MAX_PRINTED_IDS = 500;
export const MAX_PRINT_ATTEMPTS = 2;

function storageKey(locationId: string): string {
  return `platform:operator-print-outbox:${locationId}`;
}

function isOrder(value: unknown): value is BoardOrder {
  if (!value || typeof value !== 'object') return false;
  const order = value as Partial<BoardOrder>;
  return typeof order.id === 'string'
    && typeof order.shortCode === 'string'
    && typeof order.guestName === 'string'
    && typeof order.status === 'string'
    && typeof order.placedAt === 'string'
    && typeof order.updatedAt === 'string'
    && (order.scheduledFor === null || typeof order.scheduledFor === 'string')
    && (order.dailyNumber === null || Number.isInteger(order.dailyNumber))
    && typeof order.totalCents === 'number'
    && Number.isSafeInteger(order.totalCents)
    && typeof order.note === 'string'
    && typeof order.tenderType === 'string'
    && Array.isArray(order.lines)
    && order.lines.every(isLine);
}

function isLine(value: unknown): value is BoardOrder['lines'][number] {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<BoardOrder['lines'][number]>;
  return typeof line.name === 'string'
    && Number.isSafeInteger(line.quantity)
    && (line.quantity ?? 0) > 0
    && Array.isArray(line.options)
    && line.options.every((option) => typeof option === 'string')
    && (line.note === undefined || typeof line.note === 'string')
    && (line.packContents === undefined || (
      Array.isArray(line.packContents) && line.packContents.every(isPackContent)
    ));
}

function isPackContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as { itemSlug?: unknown; name?: unknown; quantity?: unknown };
  return typeof item.itemSlug === 'string'
    && typeof item.name === 'string'
    && Number.isSafeInteger(item.quantity)
    && (item.quantity as number) > 0;
}

function isJob(value: unknown): value is PrintJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<PrintJob>;
  return typeof job.id === 'string'
    && typeof job.locationName === 'string'
    && typeof job.queuedAt === 'string'
    && Number.isInteger(job.attempts)
    && (job.attempts ?? -1) >= 0
    && isOrder(job.order);
}

export async function loadPrintOutbox(
  storage: PrintStorage,
  locationId: string,
): Promise<PrintOutbox> {
  try {
    const raw = await storage.getItem(storageKey(locationId));
    if (!raw) return { jobs: [], printedIds: [] };
    const value = JSON.parse(raw) as { version?: unknown; jobs?: unknown; printedIds?: unknown };
    if (value.version !== VERSION || !Array.isArray(value.jobs) || !Array.isArray(value.printedIds)) {
      return { jobs: [], printedIds: [] };
    }
    return {
      jobs: value.jobs.filter(isJob).slice(-MAX_JOBS),
      printedIds: value.printedIds.filter((id): id is string => typeof id === 'string').slice(-MAX_PRINTED_IDS),
    };
  } catch {
    return { jobs: [], printedIds: [] };
  }
}

export async function savePrintOutbox(
  storage: PrintStorage,
  locationId: string,
  outbox: PrintOutbox,
): Promise<boolean> {
  try {
    if (outbox.jobs.length === 0 && outbox.printedIds.length === 0) {
      await storage.removeItem(storageKey(locationId));
    } else {
      await storage.setItem(storageKey(locationId), JSON.stringify({ version: VERSION, ...outbox }));
    }
    return true;
  } catch {
    return false;
  }
}

export function enqueuePrintJob(
  outbox: PrintOutbox,
  input: { locationId: string; locationName: string; order: BoardOrder; queuedAt: string },
): PrintOutbox {
  const id = `${input.locationId}:${input.order.id}`;
  if (outbox.printedIds.includes(id) || outbox.jobs.some((job) => job.id === id)) return outbox;
  if (outbox.jobs.length >= MAX_JOBS) return outbox;
  const job: PrintJob = { attempts: 0, id, locationName: input.locationName, order: input.order, queuedAt: input.queuedAt };
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
