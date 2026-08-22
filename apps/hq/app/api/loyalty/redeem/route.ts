import type { RedeemRewardRequest, RedeemRewardResponse } from '@platform/api-client';

import {
  corsPreflight,
  jsonWithCors,
  authenticate,
  idempotencyKeyOf,
  jsonError,
  notConfigured,
  parseJsonBody,
  resolveCustomer,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';

/**
 * POST /api/loyalty/redeem — spend points on a reward from the brand's
 * catalog (brand_config.loyalty.rewards: [{slug, name, points_cost}]). The
 * redemption is a negative ledger event plus the balance projection, and the
 * Idempotency-Key rides in the event note so a retried request does not
 * spend twice.
 */

type RewardEntry = { slug: string; name: string; points_cost: number };

function rewardsOf(config: unknown): RewardEntry[] {
  const raw = (config as { loyalty?: { rewards?: unknown } } | null)?.loyalty?.rewards;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is RewardEntry => {
    const candidate = entry as Partial<RewardEntry>;
    return typeof candidate.slug === 'string'
      && typeof candidate.name === 'string'
      && typeof candidate.points_cost === 'number'
      && Number.isInteger(candidate.points_cost)
      && candidate.points_cost > 0;
  });
}

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<RedeemRewardRequest>(request);
  if (body instanceof Response) return body;
  if (typeof body.rewardSlug !== 'string' || body.rewardSlug.length === 0) {
    return jsonError(400, 'invalid_request', 'rewardSlug is required.');
  }

  const brand = await db
    .from('brands')
    .select('id, brand_config')
    .eq('id', auth.claims.brand_id)
    .single<{ id: string; brand_config: unknown }>();
  if (brand.error) return jsonError(500, 'internal', 'Could not load the brand.');
  const reward = rewardsOf(brand.data.brand_config).find((entry) => entry.slug === body.rewardSlug);
  if (!reward) return jsonError(404, 'reward_unknown', 'This brand offers no such reward.');

  const customer = await resolveCustomer(db, auth);
  const account = await db
    .from('loyalty_accounts')
    .select('id, points_balance')
    .eq('customer_id', customer.id)
    .maybeSingle<{ id: string; points_balance: number }>();
  if (account.error) throw account.error;
  if (!account.data) {
    return jsonError(409, 'insufficient_points', `${reward.name} needs ${reward.points_cost} points.`);
  }

  // A key is required, because it is the only thing that makes a retry
  // distinguishable from a second redemption. The clients always send one.
  const clientKey = idempotencyKeyOf(request);
  if (!clientKey) {
    return jsonError(400, 'invalid_request', 'An Idempotency-Key header is required to redeem.');
  }
  const note = `${reward.slug} [${clientKey}]`;

  // The event row is claimed FIRST, and the unique index on (account_id,
  // note) is what decides. The previous order — look for a replay, then
  // check the balance, then write — let two concurrent retries of one key
  // both find nothing, both pass, and both store the same debited balance:
  // two rewards for one guest's points.
  const claimed = await db.from('loyalty_events').insert({
    brand_id: auth.claims.brand_id,
    account_id: account.data.id,
    type: 'redeem',
    points: -reward.points_cost,
    note,
  });
  if (claimed.error) {
    // Someone already redeemed under this key: the first attempt spent the
    // points, so answer with the balance as it stands rather than charging
    // again or reporting a failure for work that succeeded.
    if (claimed.error.code === '23505') {
      const current = await db
        .from('loyalty_accounts')
        .select('points_balance')
        .eq('id', account.data.id)
        .single<{ points_balance: number }>();
      if (current.error) throw current.error;
      const response: RedeemRewardResponse = { pointsBalance: current.data.points_balance };
      return jsonWithCors(response);
    }
    throw claimed.error;
  }

  // One statement decides affordability and moves the balance, so it cannot
  // be outrun. Null means the account could not cover it after all.
  const spent = await db.rpc('loyalty_spend', {
    account: account.data.id,
    cost: reward.points_cost,
  });
  if (spent.error) throw spent.error;
  // Null means the account could not cover it. Coerced because a bigint can
  // arrive as a string depending on the driver, and "0" is not 0.
  const nextBalance = spent.data === null || spent.data === undefined ? null : Number(spent.data);
  if (nextBalance === null) {
    // Release the claim so the guest can retry once they have the points.
    await db.from('loyalty_events').delete()
      .eq('account_id', account.data.id).eq('type', 'redeem').eq('note', note);
    return jsonError(409, 'insufficient_points', `${reward.name} needs ${reward.points_cost} points.`);
  }

  const response: RedeemRewardResponse = { pointsBalance: nextBalance };
  return jsonWithCors(response);
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
