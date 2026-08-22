/**
 * A thin, fetch-based Square API client -- OAuth, Orders, Payments, Refunds.
 * No SDK dependency: the four calls the platform makes are small, and a thin
 * client keeps the request/response shapes visible where the money moves.
 *
 * Every call needs a per-location access token (decrypted by the caller from
 * square_connections); OAuth calls use the application credentials.
 */

export type SquareEnv = 'sandbox' | 'production';

const HOSTS: Record<SquareEnv, string> = {
  sandbox: 'https://connect.squareupsandbox.com',
  production: 'https://connect.squareup.com',
};

const API_VERSION = '2025-01-23';

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
  const response = await fetch(`${config.apiBase ?? HOSTS[config.env]}${path}`, {
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

export type SquareOrderLine = {
  name: string;
  quantity: string;               // Square wants a string
  base_price_money: { amount: number; currency: 'USD' };
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
    appFeeCents: number;
    /** Where Square sends the guest afterwards; the app's order screen. */
    redirectUrl?: string;
    buyerEmail?: string;
    note?: string;
  },
): Promise<{ payment_link?: { id?: string; url?: string; order_id?: string } }> {
  return call(config, '/v2/online-checkout/payment-links', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `link-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        reference_id: input.referenceId,
        line_items: input.lines,
      },
      checkout_options: {
        allow_tipping: false,          // the tip is already priced into the order
        ask_for_shipping_address: false,
        ...(input.appFeeCents > 0
          ? { app_fee_money: { amount: input.appFeeCents, currency: 'USD' } }
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
      amount_money: { amount: input.amountCents, currency: 'USD' },
      ...(input.tipCents > 0 ? { tip_money: { amount: input.tipCents, currency: 'USD' } } : {}),
      app_fee_money: { amount: input.appFeeCents, currency: 'USD' },
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
      amount_money: { amount: input.amountCents, currency: 'USD' },
      reason: input.reason,
    },
  });
}
