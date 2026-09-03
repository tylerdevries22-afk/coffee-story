import type { BoardOrder } from './board';
import type { PrintJob } from './print-outbox';

/**
 * The runtime boundary for a print job rehydrated from storage.
 *
 * Split out of `print-outbox.ts` when the queue moved into SecureStore: the
 * guards did not change, but the file they lived in outgrew the size rule.
 */

function isPackContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as { itemSlug?: unknown; name?: unknown; quantity?: unknown };
  return typeof item.itemSlug === 'string'
    && typeof item.name === 'string'
    && Number.isSafeInteger(item.quantity)
    && (item.quantity as number) > 0;
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

export function isOrder(value: unknown): value is BoardOrder {
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

export function isJob(value: unknown): value is PrintJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<PrintJob>;
  return typeof job.id === 'string'
    && typeof job.locationName === 'string'
    && typeof job.queuedAt === 'string'
    && Number.isFinite(Date.parse(job.queuedAt))
    && Number.isInteger(job.attempts)
    && (job.attempts ?? -1) >= 0
    && isOrder(job.order);
}
