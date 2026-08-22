import type { RedeemRewardRequest, RedeemRewardResponse } from '@platform/api-client';

import {
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
  if (!account.data || account.data.points_balance < reward.points_cost) {
    return jsonError(409, 'insufficient_points', `${reward.name} needs ${reward.points_cost} points.`);
  }

  const clientKey = idempotencyKeyOf(request);
  const note = clientKey ? `${reward.slug} [${clientKey}]` : reward.slug;
  if (clientKey) {
    const replay = await db
      .from('loyalty_events')
      .select('id')
      .eq('account_id', account.data.id)
      .eq('type', 'redeem')
      .eq('note', note)
      .maybeSingle<{ id: string }>();
    if (replay.data) {
      const response: RedeemRewardResponse = { pointsBalance: account.data.points_balance };
      return Response.json(response);
    }
  }

  const redeemed = await db.from('loyalty_events').insert({
    brand_id: auth.claims.brand_id,
    account_id: account.data.id,
    type: 'redeem',
    points: -reward.points_cost,
    note,
  });
  if (redeemed.error) throw redeemed.error;
  const nextBalance = account.data.points_balance - reward.points_cost;
  const updated = await db
    .from('loyalty_accounts')
    .update({ points_balance: nextBalance })
    .eq('id', account.data.id);
  if (updated.error) throw updated.error;

  const response: RedeemRewardResponse = { pointsBalance: nextBalance };
  return Response.json(response);
}
