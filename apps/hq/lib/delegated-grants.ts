/**
 * The grants one brand has lent out, read under that brand owner's session.
 *
 * `delegated_access_grants_select` (20260903153000) gives the granting brand
 * its whole history and gives a grantee only their own live rows, so this is
 * scoped by `brand_id` rather than trusted to RLS alone: a session that is
 * both an owner and somebody else's delegate would otherwise see grants it has
 * no standing to revoke, and a revoke control over a row the database will
 * refuse is a control that lies.
 *
 * Live rows only. An expired or already-revoked grant authorizes nothing --
 * `caller_network_brand_kpis` checks both before it returns a number -- so it
 * is history, and history belongs on an audit surface rather than next to a
 * button that ends things.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { serverClient } from './supabase-server';

export type DelegatedGrant = {
  readonly id: string;
  readonly networkId: string;
  readonly granteeUserId: string;
  readonly scope: readonly string[];
  readonly expiresAt: string;
};

/** One page of grants. A brand lends to a handful of analysts, not hundreds. */
const GRANT_LIMIT = 50;

type GrantRow = {
  id: string;
  network_id: string;
  grantee_user_id: string;
  scope: string[] | null;
  expires_at: string;
};

/**
 * Drop a row rather than render a half-parsed one: an expiry that does not
 * parse would render as "Invalid Date" beside a revoke button, which reads as
 * a bug in the grant rather than in the row.
 */
export function delegatedGrantsOf(rows: unknown): readonly DelegatedGrant[] {
  if (!Array.isArray(rows)) return [];
  const parsed: DelegatedGrant[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.network_id !== 'string') continue;
    if (typeof row.grantee_user_id !== 'string' || typeof row.expires_at !== 'string') continue;
    if (Number.isNaN(Date.parse(row.expires_at))) continue;
    const scope = Array.isArray(row.scope)
      ? row.scope.filter((entry): entry is string => typeof entry === 'string')
      : [];
    parsed.push({
      expiresAt: row.expires_at,
      granteeUserId: row.grantee_user_id,
      id: row.id,
      networkId: row.network_id,
      scope,
    });
  }
  return parsed.sort((left, right) => left.expiresAt.localeCompare(right.expiresAt));
}

/** Empty when the deployment carries no Supabase env, matching every other loader. */
export async function loadIssuedGrants(
  brandId: string | null,
  providedClient?: SupabaseClient | null,
): Promise<readonly DelegatedGrant[]> {
  if (!brandId) return [];
  const client = providedClient === undefined ? await serverClient() : providedClient;
  if (!client) return [];
  const result = await client.from('delegated_access_grants')
    .select('id, network_id, grantee_user_id, scope, expires_at')
    .eq('brand_id', brandId).is('revoked_at', null).gt('expires_at', new Date().toISOString())
    .order('expires_at').limit(GRANT_LIMIT)
    .returns<GrantRow[]>();
  // A refusal is an ordinary answer: a session with no brand standing reads
  // nothing here, and the page renders the empty state rather than an error.
  if (result.error) return [];
  return delegatedGrantsOf(result.data);
}
