/**
 * The franchisor's network report, read under the franchisor's own session.
 *
 * Everything here goes through `serverClient()` -- the publishable key bound to
 * the request cookies -- so the database decides what this user may see. There
 * is deliberately no role gate in front of it and no service-role fallback:
 * network membership is a row in franchise_memberships, not a JWT claim, so a
 * `hasRole` check could only ever guess. `public.caller_network_brand_kpis`
 * resolves the subject from auth.uid() and raises network_access_denied for a
 * caller holding neither a membership nor a live delegated grant, which is the
 * authorization this page relies on.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { serverClient } from './supabase-server';

export type NetworkBrandKpi = {
  readonly brandId: string;
  readonly brandName: string;
  readonly orders30d: number;
  readonly grossCents30d: number;
};

export type NetworkReport = {
  readonly networkId: string;
  readonly networkName: string | null;
  readonly brands: readonly NetworkBrandKpi[];
};

/**
 * How many networks one page will report on.
 *
 * Each network costs one RPC round trip, and a person administers a handful of
 * them, not a hundred. The cap is here so a pathological membership list
 * cannot turn one page render into an unbounded fan-out.
 */
const NETWORK_LIMIT = 10;

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Validate the aggregate before it is rendered as money.
 *
 * A row that does not parse is dropped rather than coerced: a KPI surface that
 * silently renders NaN or a rounded float as dollars is worse than one that
 * reports fewer brands than the network holds.
 */
export function networkBrandKpisOf(rows: unknown): readonly NetworkBrandKpi[] {
  if (!Array.isArray(rows)) return [];
  const parsed: NetworkBrandKpi[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const orders30d = nonNegativeInteger(row.orders_30d);
    const grossCents30d = nonNegativeInteger(row.gross_cents_30d);
    if (typeof row.brand_id !== 'string' || typeof row.brand_name !== 'string') continue;
    if (orders30d === null || grossCents30d === null) continue;
    parsed.push({
      brandId: row.brand_id,
      brandName: row.brand_name,
      grossCents30d,
      orders30d,
    });
  }
  return parsed.sort((left, right) => right.grossCents30d - left.grossCents30d);
}

/** Gross and orders across every brand a report covers. */
export function networkTotals(brands: readonly NetworkBrandKpi[]): {
  readonly orders30d: number; readonly grossCents30d: number;
} {
  return brands.reduce(
    (totals, brand) => ({
      grossCents30d: totals.grossCents30d + brand.grossCents30d,
      orders30d: totals.orders30d + brand.orders30d,
    }),
    { grossCents30d: 0, orders30d: 0 },
  );
}

/**
 * Every network this session can name.
 *
 * Two sources, because the two kinds of reader reach a network differently. A
 * member reads franchise_networks directly -- its policy is the membership
 * check -- and gets the network's name with it. A time-boxed delegate is not a
 * member and that policy returns them nothing, but their own grant row is
 * readable and carries the network id; since 20260903153000 that policy also
 * filters revoked and expired grants, so the list is already live-only. They
 * get no name, which the page renders honestly rather than inventing one.
 */
async function reachableNetworks(
  client: SupabaseClient,
): Promise<ReadonlyMap<string, string | null>> {
  const networks = new Map<string, string | null>();
  const member = await client.from('franchise_networks')
    .select('id, name').order('name').limit(NETWORK_LIMIT)
    .returns<{ id: string; name: string }[]>();
  if (!member.error) {
    for (const row of member.data ?? []) networks.set(row.id, row.name);
  }
  const delegated = await client.from('delegated_access_grants')
    .select('network_id').contains('scope', ['network:kpis']).limit(NETWORK_LIMIT)
    .returns<{ network_id: string }[]>();
  if (!delegated.error) {
    for (const row of delegated.data ?? []) {
      if (!networks.has(row.network_id)) networks.set(row.network_id, null);
    }
  }
  return networks;
}

/** Null when the deployment carries no Supabase env, matching every other loader. */
export async function loadNetworkReports(
  providedClient?: SupabaseClient | null,
): Promise<readonly NetworkReport[]> {
  const client = providedClient === undefined ? await serverClient() : providedClient;
  if (!client) return [];
  const networks = await reachableNetworks(client);
  const reports: NetworkReport[] = [];
  for (const [networkId, networkName] of [...networks].slice(0, NETWORK_LIMIT)) {
    const result = await client.rpc('caller_network_brand_kpis', { p_network_id: networkId });
    // A refusal is an ordinary answer here: a grant can expire between the
    // listing above and this call, and the database is the authority on that.
    if (result.error) continue;
    reports.push({ brands: networkBrandKpisOf(result.data), networkId, networkName });
  }
  return reports;
}
