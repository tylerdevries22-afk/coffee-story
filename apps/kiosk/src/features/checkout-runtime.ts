/**
 * The side-effect boundary around the checkout reducer.
 *
 * The reducer remembers whether an attempt may be retried. This module turns
 * that decision into the exact key and live/demo execution target used by the
 * network call, so the safety rules are testable without mounting Expo Router.
 */
import {
  ApiError,
  AppNetworkError,
  type ApiClient,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type TenderType,
} from '@platform/api-client';
import type { KioskTender } from '@platform/domain';
import { isTerminal, type OrderStatus } from '@platform/schema';

import type { CheckoutState } from '@/features/checkout';

export type CheckoutDeviceSnapshot = {
  status: 'loading' | 'unpaired' | 'ready' | 'revoked';
  accessToken: string | null;
  locationId: string | null;
};

type OrderClient = Pick<ApiClient, 'placeOrder'>;

export type CheckoutTarget =
  | { kind: 'demo'; client?: OrderClient; locationId?: string }
  | { kind: 'live'; client: OrderClient; locationId: string }
  | { kind: 'blocked'; code: string };

export type CheckoutRuntime = {
  platform: string;
  readerIsSimulated: boolean;
  requiresReader: boolean;
  demoClient?: OrderClient | null;
  demoLocationId?: string;
  forceDemo?: boolean;
};

/** Resolve a checkout plane without ever treating a broken paired device as demo. */
export function checkoutTarget(
  device: CheckoutDeviceSnapshot,
  createClient: (accessToken: string) => OrderClient | null,
  runtime: CheckoutRuntime,
): CheckoutTarget {
  if (runtime.forceDemo) {
    if (runtime.platform !== 'web' || !runtime.demoClient || !runtime.demoLocationId) {
      return { kind: 'blocked', code: 'demo_sync_not_configured' };
    }
    return { kind: 'demo', client: runtime.demoClient, locationId: runtime.demoLocationId };
  }
  if (device.status === 'unpaired') {
    return runtime.platform === 'web'
      ? {
          kind: 'demo',
          ...(runtime.demoClient ? { client: runtime.demoClient } : {}),
          ...(runtime.demoLocationId ? { locationId: runtime.demoLocationId } : {}),
        }
      : { kind: 'blocked', code: 'device_unpaired' };
  }
  if (device.status !== 'ready') return { kind: 'blocked', code: `device_${device.status}` };
  if (!device.accessToken || !device.locationId) {
    return { kind: 'blocked', code: 'device_identity_missing' };
  }
  if (runtime.requiresReader && runtime.readerIsSimulated) {
    return { kind: 'blocked', code: 'reader_not_configured' };
  }
  try {
    const client = createClient(device.accessToken);
    return client
      ? { kind: 'live', client, locationId: device.locationId }
      : { kind: 'blocked', code: 'api_not_configured' };
  } catch {
    return { kind: 'blocked', code: 'api_not_configured' };
  }
}

export type CheckoutTenderPlan = {
  tenderType: TenderType;
  requiresReader: boolean;
};

export type CheckoutPreflight =
  | { kind: 'ready'; target: Exclude<CheckoutTarget, { kind: 'blocked' }>; tender: CheckoutTenderPlan }
  | { kind: 'blocked'; code: string };

/** Translate the guest-facing tender into the server/reader work it requires. */
export function checkoutTender(tender: KioskTender | null): CheckoutTenderPlan | null {
  if (tender === 'card') return { tenderType: 'square_card', requiresReader: true };
  if (tender === 'cash') return { tenderType: 'pay_at_pickup', requiresReader: false };
  // Balance-backed tenders are filtered from the UI until lookup/redemption is
  // implemented. Reaching processing with one must fail closed.
  return null;
}

/**
 * Resolve every prerequisite before checkout becomes non-cancellable.
 *
 * The pay screen uses the same function as processing, so it cannot advertise
 * a tender that the next screen will reject. Processing still repeats the
 * check at the side-effect boundary because device state can change between
 * the two taps.
 */
export function checkoutPreflight(
  tender: KioskTender | null,
  device: CheckoutDeviceSnapshot,
  createClient: (accessToken: string) => OrderClient | null,
  runtime: Omit<CheckoutRuntime, 'requiresReader'>,
): CheckoutPreflight {
  const tenderPlan = checkoutTender(tender);
  if (!tenderPlan) return { kind: 'blocked', code: 'tender_not_supported' };
  const target = checkoutTarget(device, createClient, {
    ...runtime,
    requiresReader: tenderPlan.requiresReader,
  });
  if (target.kind === 'blocked') return target;
  return { kind: 'ready', target, tender: tenderPlan };
}

/** Reuse the cart's committed key; mint only before its first send. */
export function checkoutAttemptKey(
  state: Pick<CheckoutState, 'attemptKey'>,
  createKey: () => string,
): string {
  return state.attemptKey ?? createKey();
}

export type CheckoutPlacement =
  | { kind: 'demo'; orderId: string }
  | { kind: 'placed'; order: PlaceOrderResponse }
  | { kind: 'ambiguous' }
  | { kind: 'failed'; code: string };

export type PlacedCheckout = Extract<CheckoutPlacement, { kind: 'demo' | 'placed' }>;

export type DemoReplayOutcome = 'continue' | 'already_authorized' | 'terminal';

/** A replay may prove payment already happened, but never resurrect a dead order. */
export function demoReplayOutcome(status: OrderStatus): DemoReplayOutcome {
  if (isTerminal(status)) return 'terminal';
  return status === 'created' ? 'continue' : 'already_authorized';
}

/** The live API's repriced total wins; local math is only for the web preview. */
export function paymentAmountCents(placement: PlacedCheckout, demoTotalCents: number): number {
  return placement.kind === 'placed' ? placement.order.totalCents : demoTotalCents;
}

/** Place once under the supplied key, conservatively classifying no-answer failures. */
export async function placeCheckoutOrder(
  target: CheckoutTarget,
  attemptKey: string,
  request: (locationId: string) => PlaceOrderRequest,
): Promise<CheckoutPlacement> {
  if (target.kind === 'demo' && !target.client) return { kind: 'demo', orderId: attemptKey };
  if (target.kind === 'blocked') return { kind: 'failed', code: target.code };
  const client = target.client;
  if (!client) return { kind: 'failed', code: 'demo_sync_not_configured' };

  let input: PlaceOrderRequest;
  try {
    input = request(target.locationId ?? 'demo');
  } catch {
    return { kind: 'failed', code: 'invalid_order' };
  }

  try {
    return { kind: 'placed', order: await client.placeOrder(input, attemptKey) };
  } catch (error) {
    return placementFailure(error);
  }
}

/** A server rejection is definite; every no-response/unknown failure is ambiguous. */
export function placementFailure(error: unknown): CheckoutPlacement {
  if (error instanceof ApiError) return { kind: 'failed', code: `order_${error.code}` };
  if (error instanceof AppNetworkError) return { kind: 'ambiguous' };
  // JSON parsing and other unexpected client errors can occur after the server
  // has committed the row. The safe recovery is therefore the same-key retry.
  return { kind: 'ambiguous' };
}
