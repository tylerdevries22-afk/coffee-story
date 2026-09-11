import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthedRequest } from './api-auth';

export type CustomerIdentity = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  sms_opt_in: boolean;
};

/**
 * The caller's customers row for their brand, created on first contact so a
 * guest's first order does not require a separate profile step.
 */
export async function resolveCustomer(
  db: SupabaseClient,
  auth: AuthedRequest,
): Promise<CustomerIdentity> {
  const existing = await db
    .from('customers')
    .select('id, full_name, email, phone, sms_opt_in')
    .eq('brand_id', auth.claims.brand_id)
    .eq('user_id', auth.userId)
    .maybeSingle<CustomerIdentity>();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await db
    .from('customers')
    .insert({
      brand_id: auth.claims.brand_id,
      user_id: auth.userId,
      full_name: '',
      email: auth.email,
    })
    .select('id, full_name, email, phone, sms_opt_in')
    .single<CustomerIdentity>();
  if (created.error) {
    // Two first-contact requests raced; the UNIQUE (brand_id, user_id) kept one.
    if (created.error.code === '23505') {
      const winner = await db
        .from('customers')
        .select('id, full_name, email, phone, sms_opt_in')
        .eq('brand_id', auth.claims.brand_id)
        .eq('user_id', auth.userId)
        .single<CustomerIdentity>();
      if (!winner.error) return winner.data;
    }
    throw created.error;
  }
  return created.data;
}
