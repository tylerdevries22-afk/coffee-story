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

export const HOSTS: Record<SquareEnv, string> = {
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

export async function call<T>(
  config: SquareConfig,
  path: string,
  init: { method: string; token?: string; clientAuthorization?: boolean; body?: unknown },
): Promise<T> {
  const response = await fetchExternalWithRetry(`${config.apiBase ?? HOSTS[config.env]}${path}`, {
    method: init.method,
    headers: {
      'Square-Version': API_VERSION,
      'Content-Type': 'application/json',
      ...(init.clientAuthorization
        ? { Authorization: `Client ${config.applicationSecret}` }
        : init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new SquareApiError(`Square ${init.method} ${path} -> ${response.status}`, response.status, body);
  }
  return body;
}

