import {
  API_ROUTES,
  type CancelOrderRequest,
  type CancelOrderResponse,
  type DeleteProfileResponse,
  type MintReferralResponse,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type RedeemRewardRequest,
  type RedeemRewardResponse,
  type RefundOrderRequest,
  type RefundOrderResponse,
  type RegisterPushTokenRequest,
  type UpdateProfileRequest,
} from './contract';
import { throwForResponse } from './errors';
import { fetchWithRetry } from './http';
import { newIdempotencyKey } from './idempotency';

export type ApiClientConfig = {
  /** e.g. https://hq.example.com — no trailing slash needed. */
  baseUrl: string;
  /** Exact hostname the base must resolve to. Fail-closed: no match, no requests. */
  allowedHost?: string;
  /** Loosens the HTTPS/host checks for localhost only. */
  developmentMode?: boolean;
  /** The caller's Supabase access token, fetched fresh per request. */
  getAccessToken: () => Promise<string | null>;
};

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Resolves and guards the base URL the way the customer app's portal-url
 * module pioneered: HTTPS-only (localhost excepted in development), exact
 * host allowlist, and a hard rejection of `//` and backslashes — WHATWG URL
 * treats `\` as `/` for special schemes, so `/\evil.com/x` would otherwise
 * resolve to https://evil.com/x and carry the bearer token with it.
 */
export function resolveApiUrl(
  path: string,
  config: Pick<ApiClientConfig, 'baseUrl' | 'allowedHost' | 'developmentMode'>,
): string {
  const base = config.baseUrl?.replace(/\/$/, '');
  if (!base) throw new Error('The platform API URL is not configured.');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('The requested API path is invalid.');
  }
  const baseUrl = new URL(base);
  const isLocal = baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1';
  const development = config.developmentMode ?? false;
  if (baseUrl.protocol !== 'https:' && !(development && isLocal)) {
    throw new Error('The platform API must use HTTPS.');
  }
  if (!(development && isLocal)) {
    if (!config.allowedHost || baseUrl.hostname !== config.allowedHost.toLowerCase()) {
      throw new Error('The platform API host is not allowlisted.');
    }
  }
  return new URL(path, `${baseUrl.toString().replace(/\/$/, '')}/`).toString();
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
    method: 'POST' | 'DELETE' = 'POST',
  ): Promise<T> {
    const token = await config.getAccessToken();
    if (!token) throw new Error('Sign in before calling the platform API.');
    const response = await fetchWithRetry(resolveApiUrl(path, config), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': idempotencyKey ?? newIdempotencyKey(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwForResponse(response);
    return (await response.json()) as T;
  }

  return {
    /**
     * `idempotencyKey` identifies the checkout ATTEMPT: hold one key across
     * user-visible retries of the same order so the server can return the
     * already-created order instead of charging twice.
     */
    placeOrder: (input: PlaceOrderRequest, idempotencyKey: string) =>
      request<PlaceOrderResponse>(API_ROUTES.orders, input, idempotencyKey),
    /** Hold one key across retries of the same redemption; the server spends once per key. */
    redeemReward: (input: RedeemRewardRequest, idempotencyKey?: string) =>
      request<RedeemRewardResponse>(API_ROUTES.loyaltyRedeem, input, idempotencyKey),
    /** The guest calling off their own order, before the shop starts it. */
    cancelOrder: (input: CancelOrderRequest, idempotencyKey?: string) =>
      request<CancelOrderResponse>(API_ROUTES.ordersCancel, input, idempotencyKey),
    /**
     * Staff only. Every other status change is a direct order_events insert
     * under RLS, but a refund moves money at Square first, so it goes through
     * the server that holds the location's token. The caller owns this key and
     * must reuse it until the user-visible attempt has a conclusive outcome.
     */
    refundOrder: (input: RefundOrderRequest, idempotencyKey: string) =>
      request<RefundOrderResponse>(API_ROUTES.ordersRefund, input, idempotencyKey),
    registerPushToken: (input: RegisterPushTokenRequest) =>
      request<{ ok: true }>(API_ROUTES.pushTokens, input),
    updateProfile: (input: UpdateProfileRequest) =>
      request<{ ok: true }>(API_ROUTES.profile, input),
    deleteProfile: () => request<DeleteProfileResponse>(API_ROUTES.profile, undefined, undefined, 'DELETE'),
    mintReferral: () => request<MintReferralResponse>(API_ROUTES.referrals, {}),
  };
}
