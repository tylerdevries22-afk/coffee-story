import type { OrderChannel, OrderStatus } from '@platform/schema';

import type {
  DemoSyncBoardTicket,
  DemoSyncOrder,
  DemoSyncSnapshot,
  DemoSyncTransitionRequest,
  PlaceOrderRequest,
  PlaceOrderResponse,
} from './contract';
import { throwForResponse } from './errors';
import { fetchWithRetry } from './http';
import { newIdempotencyKey } from './idempotency';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const REQUEST_TIMEOUT_MS = 3_000;

type PreviewLocation = {
  hostname?: unknown;
  protocol?: unknown;
};

/** Resolve the preview broker, refusing every non-loopback destination. */
export function resolveDemoSyncBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Resolve the local preview broker when Expo web does not inline public env
 * values into a static export. The fallback is deliberately loopback-only and
 * never activates for a hosted or HTTPS origin.
 */
export function resolveDemoSyncRuntimeUrl(
  value: unknown,
  location?: PreviewLocation,
): string | null {
  const configured = resolveDemoSyncBaseUrl(value);
  // An explicitly supplied value is authoritative: invalid or hosted config
  // must fail closed instead of being hidden by the local preview fallback.
  if (configured || (typeof value === 'string' && value.length > 0)) return configured;

  const runtimeLocation = location ?? getRuntimeLocation();
  const hostname = runtimeLocation?.hostname;
  const protocol = runtimeLocation?.protocol;
  if (!LOOPBACK_HOSTS.has(typeof hostname === 'string' ? hostname : '')) return null;
  if (protocol !== undefined && protocol !== 'http:') return null;

  return resolveDemoSyncBaseUrl(`http://${hostname}:3300/api/demo-sync`);
}

function getRuntimeLocation(): PreviewLocation | undefined {
  const globalWithLocation = globalThis as typeof globalThis & { location?: PreviewLocation };
  return globalWithLocation.location;
}

export type DemoSyncClient = {
  placeOrder: (input: PlaceOrderRequest, idempotencyKey: string) => Promise<PlaceOrderResponse>;
  board: () => Promise<DemoSyncBoardTicket[]>;
  orders: () => Promise<DemoSyncSnapshot>;
  transition: (orderId: string, status: OrderStatus) => Promise<DemoSyncOrder>;
};

/** Local preview client whose destination can never leave this machine. */
export function createDemoSyncClient(value: unknown, channel: OrderChannel): DemoSyncClient | null {
  const baseUrl = resolveDemoSyncBaseUrl(value);
  if (!baseUrl) return null;

  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await fetchWithRetry(`${baseUrl}${path}`, init, REQUEST_TIMEOUT_MS, 2);
    if (!response.ok) await throwForResponse(response);
    return (await response.json()) as T;
  };

  return {
    placeOrder: (input, idempotencyKey) => request<PlaceOrderResponse>('/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Demo-Sync-Channel': channel,
      },
      body: JSON.stringify(input),
    }),
    board: () => request<DemoSyncBoardTicket[]>('/board', {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    orders: () => request<DemoSyncSnapshot>('/orders', {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    transition: (orderId, status) => {
      const body: DemoSyncTransitionRequest = { status };
      return request<DemoSyncOrder>(`/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': newIdempotencyKey(),
          'X-Demo-Sync-Channel': channel,
        },
        body: JSON.stringify(body),
      });
    },
  };
}
