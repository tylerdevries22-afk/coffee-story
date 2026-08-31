/**
 * A thin, fetch-based Square API client -- OAuth, Orders, Payments, Refunds.
 * No SDK dependency: the four calls the platform makes are small, and a thin
 * client keeps the request/response shapes visible where the money moves.
 *
 * Every call needs a per-location access token (decrypted by the caller from
 * square_connections); OAuth calls use the application credentials.
 */

import { fetchExternalWithRetry } from '../http';

export type SquareEnv = 'sandbox' | 'production';

const HOSTS: Record<SquareEnv, string> = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
};

const API_VERSION = '2025-01-23';

/**
 * The one currency the platform settles in.
 *
 * Deliberately a constant rather than a parameter. Currency is not the only
 * thing a shop outside this world would need changed: tax is modelled as US
 * jurisdictions, a delivery address validates a two-letter state and a ZIP,
 * and `formatMoney` prints a bare `$`. A code threaded onto the payment would
 * take that shop's money into a system that still could not serve it.
 *
 * So it is asserted once here, and checked against the merchant's own Square
 * location before a shop is connected -- not assumed eight times over, in the
 * calls where the money actually moves.
 */
export const PLATFORM_CURRENCY = 'USD';

export type PlatformCurrency = typeof PLATFORM_CURRENCY;

export type SquareConfig = {
  env: SquareEnv;
  applicationId: string;
  applicationSecret: string;
  /**
   * Overrides the host for `env`. Exists so the money paths can be exercised
   * against a stand-in Square without touching the network -- the integration
   * suite points this at a local server that answers real request shapes.
   */
  apiBase?: string;
};

export function squareConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SquareConfig {
  const applicationId = env.SQUARE_APP_ID;
  const applicationSecret = env.SQUARE_APP_SECRET;
  if (!applicationId || !applicationSecret) {
    throw new Error('Set SQUARE_APP_ID and SQUARE_APP_SECRET (server environment only).');
  }
  return {
    env: env.SQUARE_ENV === 'production' ? 'production' : 'sandbox',
    applicationId,
    applicationSecret,
    ...(env.SQUARE_API_BASE ? { apiBase: env.SQUARE_API_BASE } : {}),
  };
}

export class SquareApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(
  config: SquareConfig,
  path: string,
  init: { method: string; token?: string; body?: unknown },
): Promise<T> {
  const response = await fetchExternalWithRetry(`${config.apiBase ?? HOSTS[config.env]}${path}`, {
    method: init.method,
    headers: {
      'Square-Version': API_VERSION,
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new SquareApiError(`Square ${init.method} ${path} -> ${response.status}`, response.status, body);
  }
  return body;
}

/** The consent URL Locations' "Connect Square" sends a browser to. */
export function oauthAuthorizeUrl(config: SquareConfig, state: string): string {
  const scopes = ['MERCHANT_PROFILE_READ', 'ORDERS_WRITE', 'ORDERS_READ', 'PAYMENTS_WRITE', 'PAYMENTS_READ'];
  const params = new URLSearchParams({
    client_id: config.applicationId,
    scope: scopes.join(' '),
    session: 'false',
    state,
  });
  return `${HOSTS[config.env]}/oauth2/authorize?${params}`;
}

export type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
};

export function exchangeOAuthCode(config: SquareConfig, code: string): Promise<OAuthTokens> {
  return call<OAuthTokens>(config, '/oauth2/token', {
    method: 'POST',
    body: {
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      grant_type: 'authorization_code',
      code,
    },
  });
}

export function refreshOAuthToken(config: SquareConfig, refreshToken: string): Promise<OAuthTokens> {
  return call<OAuthTokens>(config, '/oauth2/token', {
    method: 'POST',
    body: {
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  });
}

export function revokeOAuthToken(config: SquareConfig, accessToken: string): Promise<unknown> {
  return call(config, '/oauth2/revoke', {
    method: 'POST',
    body: { client_id: config.applicationId, access_token: accessToken },
  });
}

/**
 * A stored access token, judged against its recorded expiry.
 *
 * `refreshOAuthToken` existed and nothing called it: `square_connections`
 * stored `expires_at` and no code read it. A Square access token lasts thirty
 * days, so every connected shop would have stopped taking cards a month after
 * connecting, on a 401 from Square that nothing in the product explained.
 *
 * Three states rather than a boolean, because what to do when the refresh
 * itself fails depends on which one it is: a token inside the margin is still
 * good and the sale should go through on it, while an expired one must not be
 * sent to Square as if it were money.
 *
 * An absent or unreadable expiry reads as `refresh_soon`: a connection stored
 * before this was checked should be renewed if it can be, and still spend if
 * it cannot.
 */
export type SquareTokenState = 'fresh' | 'refresh_soon' | 'expired';

/** Seven days: long enough that a shop trading weekly still renews in time. */
export const SQUARE_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

export function squareTokenState(
  expiresAt: string | null | undefined,
  nowMs: number,
  marginMs: number = SQUARE_REFRESH_MARGIN_MS,
): SquareTokenState {
  if (!expiresAt) return 'refresh_soon';
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return 'refresh_soon';
  if (nowMs >= expiry) return 'expired';
  return nowMs >= expiry - marginMs ? 'refresh_soon' : 'fresh';
}

/** One of the merchant's own Square locations, as `/v2/locations` reports it. */
export type SquareMerchantLocation = {
  id: string;
  name?: string;
  status?: string;
  currency?: string;
};

/**
 * The merchant's Square locations. `MERCHANT_PROFILE_READ` is requested at
 * consent for this call and nothing else.
 */
export async function listSquareLocations(
  config: SquareConfig,
  token: string,
): Promise<SquareMerchantLocation[]> {
  const body = await call<{ locations?: SquareMerchantLocation[] }>(config, '/v2/locations', {
    method: 'GET',
    token,
  });
  return body.locations ?? [];
}

export type SquareLocationRefusal = 'no_active_location' | 'unsupported_currency' | 'several_locations';

export type SquareLocationChoice =
  | { ok: true; location: SquareMerchantLocation }
  | { ok: false; reason: SquareLocationRefusal };

/**
 * Which of a merchant's Square locations a shop bills against.
 *
 * Only an unambiguous answer counts. Binding the wrong one sends a shop's
 * takings to a sibling store's books, and no heuristic over names or addresses
 * is worth that: several candidates is a question for the owner, not a guess.
 * Refusing is safe, because nothing is written until this says yes.
 *
 * A missing `status` or `currency` is read generously -- Square sends both, and
 * refusing a whole merchant over a field that did not arrive would be a worse
 * failure than the one this guards against.
 */
export function chooseSquareLocation(
  locations: readonly SquareMerchantLocation[],
): SquareLocationChoice {
  const active = locations.filter((location) => location.id && (location.status ?? 'ACTIVE') === 'ACTIVE');
  if (active.length === 0) return { ok: false, reason: 'no_active_location' };
  // A merchant who settles in another currency cannot be served by this
  // platform at all (see PLATFORM_CURRENCY), and the honest place to say so is
  // here, once, rather than as a rejected payment at a guest's first checkout.
  const payable = active.filter((location) => (location.currency ?? PLATFORM_CURRENCY) === PLATFORM_CURRENCY);
  if (payable.length === 0) return { ok: false, reason: 'unsupported_currency' };
  if (payable.length > 1) return { ok: false, reason: 'several_locations' };
  const [only] = payable;
  if (!only) return { ok: false, reason: 'no_active_location' };
  return { ok: true, location: only };
}

export type SquareOrderLine = {
  name: string;
  quantity: string;               // Square wants a string
  base_price_money: { amount: number; currency: PlatformCurrency };
  note?: string;
};

export function createSquareOrder(
  config: SquareConfig,
  token: string,
  input: { squareLocationId: string; referenceId: string; lines: SquareOrderLine[] },
): Promise<{ order?: { id?: string } }> {
  return call(config, '/v2/orders', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `order-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        reference_id: input.referenceId,
        line_items: input.lines,
      },
    },
  });
}

/**
 * A hosted checkout page for one order: the tender that works in Expo Go and
 * in a web build, where no native card SDK exists. Square hosts the page and
 * takes the card; the payment webhook is what moves the order to paid, so
 * nothing here trusts the browser coming back.
 *
 * `app_fee_money` rides on checkout_options rather than the payment (rule 3
 * still applies -- the platform's cut is set when the link is minted).
 */
export function createPaymentLink(
  config: SquareConfig,
  token: string,
  input: {
    squareLocationId: string;
    referenceId: string;
    lines: SquareOrderLine[];
    /**
     * Tax and tip as exact amounts, not percentages Square recomputes.
     * The platform rounds tax per row per authority, and the guest must be
     * charged the total those rows add up to — a percentage handed to Square
     * can land a cent away from it, which is a cent nobody can reconcile.
     */
    taxCents: number;
    taxLabel: string;
    tipCents: number;
    appFeeCents: number;
    /** Where Square sends the guest afterwards; the app's order screen. */
    redirectUrl?: string;
    buyerEmail?: string;
    note?: string;
  },
): Promise<{ payment_link?: { id?: string; url?: string; order_id?: string } }> {
  const serviceCharges = [
    ...(input.taxCents > 0 ? [{
      name: input.taxLabel,
      amount_money: { amount: input.taxCents, currency: PLATFORM_CURRENCY },
      calculation_phase: 'TOTAL_PHASE',
      taxable: false,
    }] : []),
    ...(input.tipCents > 0 ? [{
      name: 'Tip',
      amount_money: { amount: input.tipCents, currency: PLATFORM_CURRENCY },
      calculation_phase: 'TOTAL_PHASE',
      taxable: false,
    }] : []),
  ];
  return call(config, '/v2/online-checkout/payment-links', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `link-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        reference_id: input.referenceId,
        line_items: input.lines,
        ...(serviceCharges.length > 0 ? { service_charges: serviceCharges } : {}),
      },
      checkout_options: {
        allow_tipping: false,          // the tip is already priced into the order
        ask_for_shipping_address: false,
        ...(input.appFeeCents > 0
          ? { app_fee_money: { amount: input.appFeeCents, currency: PLATFORM_CURRENCY } }
          : {}),
        ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
      },
      ...(input.buyerEmail ? { pre_populated_data: { buyer_email: input.buyerEmail } } : {}),
      ...(input.note ? { payment_note: input.note } : {}),
    },
  });
}

export function createSquarePayment(
  config: SquareConfig,
  token: string,
  input: {
    sourceId: string;             // card nonce / payment token from the app
    squareOrderId: string;
    referenceId: string;
    amountCents: number;
    tipCents: number;
    appFeeCents: number;          // rule 3: the platform's cut, every payment
  },
): Promise<{ payment?: { id?: string; status?: string } }> {
  return call(config, '/v2/payments', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `pay-${input.referenceId}`,
      source_id: input.sourceId,
      order_id: input.squareOrderId,
      amount_money: { amount: input.amountCents, currency: PLATFORM_CURRENCY },
      ...(input.tipCents > 0 ? { tip_money: { amount: input.tipCents, currency: PLATFORM_CURRENCY } } : {}),
      app_fee_money: { amount: input.appFeeCents, currency: PLATFORM_CURRENCY },
    },
  });
}

export function refundSquarePayment(
  config: SquareConfig,
  token: string,
  input: { paymentId: string; amountCents: number; referenceId: string; reason: string },
): Promise<{ refund?: { id?: string; status?: string } }> {
  return call(config, '/v2/refunds', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `refund-${input.referenceId}`,
      payment_id: input.paymentId,
      amount_money: { amount: input.amountCents, currency: PLATFORM_CURRENCY },
      reason: input.reason,
    },
  });
}
