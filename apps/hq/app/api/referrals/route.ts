import { randomInt } from 'node:crypto';

import type { MintReferralResponse } from '@platform/api-client';

import {
  authenticate,
  notConfigured,
  resolveCustomer,
  serverEnv,
  serviceDb,
} from '../../../lib/api-auth';

/**
 * POST /api/referrals — mint (or re-surface) the caller's share code. One
 * open code per guest: minting again returns the code already issued, so the
 * share sheet always shows the same one.
 */

// No 0/O/1/I: the code gets read aloud over a counter.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function newCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const customer = await resolveCustomer(db, auth);

  const existing = await db
    .from('referrals')
    .select('code')
    .eq('brand_id', auth.claims.brand_id)
    .eq('referrer_customer_id', customer.id)
    .eq('status', 'issued')
    .limit(1)
    .maybeSingle<{ code: string }>();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const response: MintReferralResponse = { code: existing.data.code };
    return Response.json(response);
  }

  // UNIQUE (brand_id, code): on the rare collision, roll again.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const minted = await db.from('referrals').insert({
      brand_id: auth.claims.brand_id,
      referrer_customer_id: customer.id,
      code,
    });
    if (!minted.error) {
      const response: MintReferralResponse = { code };
      return Response.json(response, { status: 201 });
    }
    if (minted.error.code !== '23505') throw minted.error;
  }
  throw new Error('Could not mint a unique referral code.');
}
