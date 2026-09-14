/**
 * The shared edge for platform-integration reads: an external product asking
 * this platform for one brand's ordering summary.
 *
 * Kept out of the route so the route stays a thin HTTP shell, and so the
 * row -> response mapping is a pure function a unit test can reach without a
 * database. Imports are relative, not `@/`, because the integration suites
 * load route modules in process.
 */
import { randomUUID } from 'node:crypto';

import type { OrderingSummaryResponse } from '@platform/api-client';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  authenticate, jsonError, serverEnv, serviceDb, authenticatedDb, matchesSecret,
  type ServerEnv,
} from './api-auth';
import { clientIdentity, rateLimited } from './rate-limit';

/** One row of public.caller_brand_ordering_summary(uuid). */
export type OrderingSummaryRow = {
  brand_slug: string;
  brand_name: string;
  location_id: string;
  location_name: string;
  location_timezone: string;
  ordering_paused: boolean;
  local_day: string;
  orders_today: number;
  revenue_cents_today: number;
  fee_cents_today: number;
  fee_cents_month_to_date: number;
  square_connected: boolean;
  square_needs_reconsent: boolean;
  menu_published: boolean;
  menu_id: string | null;
  menu_updated_at: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A second factor in front of the bearer token, so a stolen integration token
 * is not on its own enough, and so the internet's traffic is refused before it
 * costs a GoTrue round trip.
 *
 * Deliberately NOT listed in CORS_HEADERS' allowed headers: a browser preflight
 * therefore cannot satisfy it, which makes this route unreachable from a page
 * by construction rather than by policy.
 */
export function integrationKeyAccepted(request: Request): boolean {
  const expected = process.env.ELEVATE_INTEGRATION_SECRET;
  if (!expected) return false;
  return matchesSecret(request.headers.get('x-integration-key'), expected);
}

export type IntegrationContext = {
  env: ServerEnv;
  db: SupabaseClient;
  userId: string;
  brandId: string;
};

/**
 * Env, second factor, both rate limits, bearer verification, and the
 * caller-scoped client -- in that order, cheapest refusal first.
 *
 * The per-IP budget guards the GoTrue round trip from an unauthenticated
 * flood. The per-account budget is keyed on the verified user AND the brand,
 * because the caller arrives from one deployment's shared egress: bucketing on
 * IP alone would let one busy tenant's tab starve every other brand.
 */
export async function integrationContext(
  request: Request,
  now = Date.now(),
): Promise<IntegrationContext | Response> {
  const env = serverEnv();
  if (!env) return jsonError(501, 'not_configured', 'This deployment has no Supabase configuration.');
  if (!integrationKeyAccepted(request)) {
    return jsonError(401, 'unauthorized', 'This integration is not configured for that key.');
  }
  if (rateLimited(clientIdentity(request), 'integrations/ordering-summary-edge', now, 120)) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again shortly.');
  }
  const brandId = new URL(request.url).searchParams.get('brandId') ?? '';
  if (!UUID.test(brandId)) {
    return jsonError(400, 'invalid_request', 'Name the brand as a uuid in brandId.');
  }
  const auth = await authenticate(request, serviceDb(env));
  if (auth instanceof Response) return auth;
  if (rateLimited(auth.userId, `integrations/ordering-summary:${brandId}`, now, 60)) {
    return jsonError(429, 'rate_limited', 'Too many requests for this brand. Try again shortly.');
  }
  const db = authenticatedDb(env, request);
  if (!db) return jsonError(401, 'unauthorized', 'Send a Supabase access token as a Bearer token.');
  return { env, db, userId: auth.userId, brandId };
}

/**
 * Rows to the wire shape. Pure, so its arithmetic is unit-testable.
 *
 * A brand with no locations yields no rows, and that is a real answer -- an
 * enrolled brand that has not opened yet -- so it returns a response with empty
 * locations and zero totals rather than null. The caller distinguishes "no
 * locations" from "could not read" by the HTTP status, never by the body.
 */
export function orderingSummaryFrom(
  brandId: string,
  rows: readonly OrderingSummaryRow[],
  generatedAt: string,
): OrderingSummaryResponse {
  const first = rows[0];
  const locations = rows.map((row) => ({
    id: row.location_id,
    name: row.location_name,
    timezone: row.location_timezone,
    orderingPaused: row.ordering_paused,
    day: row.local_day,
    ordersToday: Number(row.orders_today),
    revenueCentsToday: Number(row.revenue_cents_today),
    feeCentsToday: Number(row.fee_cents_today),
    feeCentsMonthToDate: Number(row.fee_cents_month_to_date),
    square: { connected: row.square_connected, needsReconsent: row.square_needs_reconsent },
  }));
  const sum = (pick: (one: (typeof locations)[number]) => number): number =>
    locations.reduce((total, one) => total + pick(one), 0);
  return {
    brand: { id: brandId, slug: first?.brand_slug ?? '', name: first?.brand_name ?? '' },
    generatedAt,
    locations,
    totals: {
      ordersToday: sum((one) => one.ordersToday),
      revenueCentsToday: sum((one) => one.revenueCentsToday),
      feeCentsToday: sum((one) => one.feeCentsToday),
      feeCentsMonthToDate: sum((one) => one.feeCentsMonthToDate),
    },
    menu: {
      published: first?.menu_published ?? false,
      publishedMenuId: first?.menu_id ?? null,
      updatedAt: first?.menu_updated_at ?? null,
    },
  };
}

/** A request id for the log line, so one read can be traced end to end. */
export const integrationRequestId = (): string => `int_${randomUUID()}`;
