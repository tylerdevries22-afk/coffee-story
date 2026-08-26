import {
  type DemoSyncBoardTicket,
  type DemoSyncOrder,
  type DemoSyncSnapshot,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
} from '@platform/api-client';
import { parseGuestLabel } from '@platform/domain';
import { canTransition, type OrderChannel, type OrderStatus } from '@platform/schema';

const FIRST_DAILY_NUMBER = 46;

export type DemoSyncErrorCode =
  | 'invalid_request'
  | 'idempotency_conflict'
  | 'not_found'
  | 'transition_invalid';

const DEMO_SYNC_ERROR_CODES = new Set<DemoSyncErrorCode>([
  'invalid_request', 'idempotency_conflict', 'not_found', 'transition_invalid',
]);

export class DemoSyncError extends Error {
  constructor(
    readonly code: DemoSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DemoSyncError';
  }
}

/** Next compiles route handlers separately, so errors cross chunk/HMR boundaries structurally. */
export function isDemoSyncError(value: unknown): value is DemoSyncError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { code?: unknown; message?: unknown; name?: unknown };
  return candidate.name === 'DemoSyncError'
    && typeof candidate.message === 'string'
    && DEMO_SYNC_ERROR_CODES.has(candidate.code as DemoSyncErrorCode);
}

export type DemoSyncStore = ReturnType<typeof createDemoSyncStore>;
type StoredOrder = { fingerprint: string; order: DemoSyncOrder; response: PlaceOrderResponse };
type StoredTransition = { fingerprint: string; response: DemoSyncOrder };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FULFILLMENT_TYPES = new Set(['pickup', 'curbside', 'catering', 'delivery']);
const TENDER_TYPES = new Set(['pay_at_pickup', 'external', 'square_link', 'square_card']);

function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validLine(value: unknown): boolean {
  if (!isRecord(value) || typeof value.itemSlug !== 'string' || !SLUG.test(value.itemSlug)) return false;
  if (!Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 100) return false;
  if (value.sizeSlug !== undefined && value.sizeSlug !== null
    && (typeof value.sizeSlug !== 'string' || !SLUG.test(value.sizeSlug))) return false;
  if (value.modifierSlugs !== undefined && (!Array.isArray(value.modifierSlugs)
    || value.modifierSlugs.length > 50
    || value.modifierSlugs.some((slug) => typeof slug !== 'string' || !SLUG.test(slug)))) return false;
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 500)) return false;
  if (value.packContents !== undefined && (!Array.isArray(value.packContents)
    || value.packContents.length === 0
    || value.packContents.length > 100
    || value.packContents.some((content) => !isRecord(content)
      || typeof content.itemSlug !== 'string'
      || !SLUG.test(content.itemSlug)
      || !Number.isInteger(content.quantity)
      || Number(content.quantity) < 1
      || Number(content.quantity) > 100))) return false;
  return true;
}

function validateOrder(value: unknown): asserts value is PlaceOrderRequest {
  if (!isRecord(value)) throw new DemoSyncError('invalid_request', 'The demo order must be an object.');
  const input = value;
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 50) {
    throw new DemoSyncError('invalid_request', 'The demo order needs between 1 and 50 lines.');
  }
  if (input.lines.some((line) => !validLine(line))) {
    throw new DemoSyncError('invalid_request', 'A demo line has an invalid item, quantity, size, or modifier.');
  }
  if (typeof input.locationId !== 'string' || input.locationId.length > 100
    || !FULFILLMENT_TYPES.has(String(input.fulfillmentType))
    || !TENDER_TYPES.has(String(input.tenderType))) {
    throw new DemoSyncError('invalid_request', 'The demo location, fulfillment, or tender is invalid.');
  }
  if (input.scheduledFor !== undefined && input.scheduledFor !== null
    && (typeof input.scheduledFor !== 'string' || Number.isNaN(Date.parse(input.scheduledFor)))) {
    throw new DemoSyncError('invalid_request', 'The demo pickup time must be an ISO timestamp.');
  }
  if (!Number.isInteger(input.maximumTotalCents) || Number(input.maximumTotalCents) < 0
    || Number(input.maximumTotalCents) > 10_000_000) {
    throw new DemoSyncError('invalid_request', 'The preview must send its approved total.');
  }
  if (!Number.isInteger(input.tipCents) || Number(input.tipCents) < 0
    || Number(input.tipCents) > Number(input.maximumTotalCents)) {
    throw new DemoSyncError('invalid_request', 'The demo tip must be whole cents.');
  }
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500)) {
    throw new DemoSyncError('invalid_request', 'The demo note is too long.');
  }
  if (parseGuestLabel(input.guestLabel).kind === 'rejected') {
    throw new DemoSyncError('invalid_request', 'The display name is not safe for the pickup board.');
  }
}

function demoOrder(
  input: PlaceOrderRequest,
  sessionId: string,
  id: string,
  channel: OrderChannel,
  dailyNumber: number,
  now: Date,
): DemoSyncOrder {
  const label = parseGuestLabel(input.guestLabel);
  return {
    sessionId, id, shortCode: String(dailyNumber),
    guestName: label.kind === 'ok' ? label.label : '',
    status: 'created', placedAt: now.toISOString(), dailyNumber, updatedAt: now.toISOString(),
    scheduledFor: input.scheduledFor ?? null,
    lines: input.lines.map((line) => ({
      name: titleFromSlug(line.itemSlug), quantity: line.quantity,
      options: [line.sizeSlug, ...(line.modifierSlugs ?? [])]
        .filter((value): value is string => typeof value === 'string').map(titleFromSlug),
      ...(line.note ? { note: line.note } : {}),
      ...(line.packContents ? {
        packContents: line.packContents.map((content) => ({
          itemSlug: content.itemSlug,
          name: titleFromSlug(content.itemSlug),
          quantity: content.quantity,
        })),
      } : {}),
    })),
    totalCents: input.maximumTotalCents ?? 0,
    note: input.note?.trim().slice(0, 200) ?? '',
    tenderType: input.tenderType, channel, fulfillmentType: input.fulfillmentType,
  };
}

function orderFingerprint(input: PlaceOrderRequest, channel: OrderChannel): string {
  const label = parseGuestLabel(input.guestLabel);
  const canonicalInput = label.kind === 'ok' ? { ...input, guestLabel: label.label } : input;
  return JSON.stringify({ input: canonicalInput, channel });
}

function cloneDemoOrder(order: DemoSyncOrder): DemoSyncOrder {
  return {
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      options: [...line.options],
      ...(line.packContents ? {
        packContents: line.packContents.map((content) => ({ ...content })),
      } : {}),
    })),
  };
}

/** Project the local broker to the same narrow contract as board_tickets. */
export function demoSyncBoardTickets(snapshot: DemoSyncSnapshot): DemoSyncBoardTicket[] {
  return snapshot.orders.flatMap((order) => (
    order.status === 'paid' || order.status === 'in_progress' || order.status === 'ready'
      ? [{
        id: order.id,
        dailyNumber: order.dailyNumber,
        guestName: order.guestName,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        channel: order.channel,
        updatedAt: order.updatedAt,
      }]
      : []
  ));
}

/** An isolated store factory; the local HQ process owns one instance. */
export function createDemoSyncStore(
  now: () => Date = () => new Date(),
  sessionId = crypto.randomUUID(),
) {
  const byId = new Map<string, StoredOrder>();
  const transitionsByKey = new Map<string, StoredTransition>();
  let revision = 0;
  let nextDailyNumber = FIRST_DAILY_NUMBER;
  return {
    snapshot(): DemoSyncSnapshot {
      return { sessionId, revision, orders: [...byId.values()].map((entry) => cloneDemoOrder(entry.order)) };
    },
    place(input: unknown, idempotencyKey: string, channel: OrderChannel) {
      validateOrder(input);
      const fingerprint = orderFingerprint(input, channel);
      const existing = byId.get(idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new DemoSyncError('idempotency_conflict', 'That checkout key already belongs to another order.');
        }
        return { response: existing.response, replayed: true };
      }
      const order = demoOrder(input, sessionId, idempotencyKey, channel, nextDailyNumber, now());
      nextDailyNumber += 1;
      const response: PlaceOrderResponse = {
        orderId: order.id, status: order.status,
        subtotalCents: Math.max(0, order.totalCents - input.tipCents),
        taxCents: 0, tipCents: input.tipCents, totalCents: order.totalCents,
        dailyNumber: order.dailyNumber,
      };
      byId.set(order.id, { fingerprint, order, response });
      revision += 1;
      return { response, replayed: false };
    },
    transition(
      orderId: string,
      status: OrderStatus,
      channel: OrderChannel,
      idempotencyKey = crypto.randomUUID(),
    ): DemoSyncOrder {
      const fingerprint = JSON.stringify({ orderId, status, channel });
      const replay = transitionsByKey.get(idempotencyKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint) {
          throw new DemoSyncError('idempotency_conflict', 'That transition key belongs to another change.');
        }
        return cloneDemoOrder(replay.response);
      }
      const stored = byId.get(orderId);
      if (!stored) throw new DemoSyncError('not_found', 'That demo order does not exist.');
      if (stored.order.status === status) {
        const response = cloneDemoOrder(stored.order);
        transitionsByKey.set(idempotencyKey, { fingerprint, response });
        return response;
      }
      const guestChannel = channel === 'app' || channel === 'web';
      const guestMove = stored.order.status === 'created'
        && (status === 'paid' || status === 'cancelled');
      if (guestChannel && !guestMove) {
        throw new DemoSyncError(
          'transition_invalid',
          'This order can no longer be changed by the guest. Ask the shop for help.',
        );
      }
      if (!canTransition(stored.order.status, status)) {
        throw new DemoSyncError('transition_invalid', 'That demo order cannot move to the requested status.');
      }
      stored.order = { ...stored.order, status, updatedAt: now().toISOString() };
      stored.response = { ...stored.response, status };
      revision += 1;
      const response = cloneDemoOrder(stored.order);
      transitionsByKey.set(idempotencyKey, { fingerprint, response });
      return response;
    },
  };
}

type DemoSyncGlobal = typeof globalThis & {
  __coffeeStoryDemoSyncStore?: DemoSyncStore;
};

// Next compiles route handlers into separate chunks. A module singleton is
// therefore one store per route, while globalThis is one store per local HQ
// process and survives development hot reloads.
const demoSyncGlobal = globalThis as DemoSyncGlobal;
export const demoSyncStore = demoSyncGlobal.__coffeeStoryDemoSyncStore ?? createDemoSyncStore();
demoSyncGlobal.__coffeeStoryDemoSyncStore = demoSyncStore;
