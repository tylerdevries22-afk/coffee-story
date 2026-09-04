'use server';

/**
 * The four franchise-network writes, one action per RPC.
 *
 * Every one goes through `serverClient()` -- the publishable key bound to the
 * request cookies -- and calls a `security definer` function that resolves the
 * acting user from `auth.uid()` itself (20260904010000). No service-role key
 * appears in this path, and no `hasRole` check stands in front of the two
 * actions whose authority is not in the token: enrolling a brand admits the
 * network's own franchisor_admins, and revoking a grant admits the granting
 * brand's owner, and neither standing is a JWT claim -- one is a row in
 * franchise_memberships, the other is checked against the grant's own
 * brand_id. A role gate here could only guess, and guessing wrong means the
 * console hides a control from the person the database would have admitted.
 *
 * Creating a network is different: it is platform_admin only, that role IS a
 * claim, and gating it here means the operator gets an error instead of a
 * database refusal -- the same trade `organizations/actions.ts` makes.
 */
import { revalidatePath } from 'next/cache';

import { slugify } from '@platform/domain';

import { currentSession, hasRole } from '@/lib/auth';
import { serverClient } from '@/lib/supabase-server';

/** The `franchise_networks.slug` CHECK, restated so a bad handle fails here. */
const NETWORK_SLUG = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
/** `app.valid_delegated_scope`, per entry. */
const SCOPE_ENTRY = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The delegated-grant CHECK: `expires_at <= created_at + interval '30 days'`. */
const MAX_GRANT_DAYS = 30;

async function networkClient() {
  const client = await serverClient();
  if (!client) throw new Error('This deployment is not connected to Supabase.');
  return client;
}

function requiredText(formData: FormData, key: string, label: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function uuidField(formData: FormData, key: string, label: string): string {
  const value = requiredText(formData, key, label);
  if (!UUID.test(value)) throw new Error(`${label} is not a valid identifier.`);
  return value;
}

/**
 * Scope entries, comma- or whitespace-separated.
 *
 * Bounded at 32 because the table's CHECK is, and de-duplicated because a
 * repeated entry buys nothing and spends one of the 32.
 */
function scopeField(formData: FormData): string[] {
  const raw = requiredText(formData, 'scope', 'At least one scope');
  const entries = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  if (entries.length === 0 || entries.length > 32) throw new Error('Enter between 1 and 32 scopes.');
  for (const entry of entries) {
    if (!SCOPE_ENTRY.test(entry)) throw new Error(`'${entry}' is not a valid scope, e.g. network:kpis.`);
  }
  return entries;
}

/**
 * Days-from-now as an absolute instant.
 *
 * The database refuses anything outside (now, now + 30 days], and it is the
 * authority -- this only keeps a mistyped field from becoming a round trip.
 */
function expiresAtField(formData: FormData): string {
  const days = Number(formData.get('expiresInDays'));
  if (!Number.isInteger(days) || days < 1 || days > MAX_GRANT_DAYS) {
    throw new Error(`Choose between 1 and ${MAX_GRANT_DAYS} days.`);
  }
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function createFranchiseNetworkAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'platform_admin')) {
    throw new Error('Platform administrator access is required to create a network.');
  }
  const name = requiredText(formData, 'name', 'A network name');
  if (name.length > 80) throw new Error('That network name is too long.');
  const supplied = String(formData.get('slug') ?? '').trim();
  const slug = supplied || slugify(name, 50);
  if (!NETWORK_SLUG.test(slug)) {
    throw new Error('A network handle is 3-50 characters, starts with a letter, and uses only lowercase letters, digits and hyphens.');
  }
  const client = await networkClient();
  const created = await client.rpc('create_franchise_network', { p_name: name, p_slug: slug });
  if (created.error || typeof created.data !== 'string') {
    throw new Error('The network could not be created — that handle may already be taken.');
  }
  revalidatePath('/network');
}

export async function enrollBrandInNetworkAction(formData: FormData): Promise<void> {
  const networkId = uuidField(formData, 'networkId', 'A network');
  const brandId = uuidField(formData, 'brandId', 'A brand');
  const client = await networkClient();
  const enrolled = await client.rpc('enroll_brand_in_network', {
    p_brand_id: brandId,
    p_network_id: networkId,
  });
  // The RPC is idempotent and answers false for a brand that was already
  // enrolled. That is a success, not a failure: only `error` is one.
  if (enrolled.error) throw new Error('The brand could not be enrolled in that network.');
  revalidatePath('/network');
}

export async function grantDelegatedAccessAction(formData: FormData): Promise<void> {
  const networkId = uuidField(formData, 'networkId', 'A network');
  const brandId = uuidField(formData, 'brandId', 'A brand');
  const granteeUserId = uuidField(formData, 'granteeUserId', 'A grantee');
  const scope = scopeField(formData);
  const expiresAt = expiresAtField(formData);
  const client = await networkClient();
  const granted = await client.rpc('grant_delegated_access', {
    p_brand_id: brandId,
    p_expires_at: expiresAt,
    p_grantee_user_id: granteeUserId,
    p_network_id: networkId,
    p_scope: scope,
  });
  if (granted.error || typeof granted.data !== 'string') {
    throw new Error('The delegated grant could not be issued — check that the brand is enrolled in that network.');
  }
  revalidatePath('/network');
}

/**
 * Ending a delegation immediately.
 *
 * Before 20260904010000 nothing wrote `revoked_at` except the retention sweep,
 * which only back-dates grants that had already run out -- so cutting a
 * delegate's access meant waiting up to thirty days for `expires_at`. This is
 * that path. It is idempotent in the database, so a double submit is a no-op
 * rather than an error, and the page simply re-renders without the grant.
 */
export async function revokeDelegatedAccessAction(formData: FormData): Promise<void> {
  const grantId = uuidField(formData, 'grantId', 'A grant');
  const client = await networkClient();
  const revoked = await client.rpc('revoke_delegated_access', { p_grant_id: grantId });
  if (revoked.error) throw new Error('That grant could not be revoked.');
  revalidatePath('/network');
}
