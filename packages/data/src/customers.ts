import type { SupabaseClient } from '@supabase/supabase-js';

import type { CustomerRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

/** The signed-in guest's own customer row, or null before first order. */
export async function fetchCustomerByUser(
  client: SupabaseClient,
  userId: string,
): Promise<CustomerRow | null> {
  return readWithRetry('fetchCustomerByUser', (signal) => abortRead(client
    .from('customers')
    .select('*')
    .eq('user_id', userId), signal)
    .maybeSingle<CustomerRow>());
}

/**
 * Creates or refreshes the guest's own row under RLS: the insert policy pins
 * user_id to auth.uid() and brand_id to the JWT claim, so a client can only
 * ever write itself into the brand its token names.
 */
export async function upsertOwnCustomer(
  client: SupabaseClient,
  input: { brandId: string; userId: string; fullName: string; email?: string | null; phone?: string | null },
): Promise<CustomerRow> {
  const existing = await fetchCustomerByUser(client, input.userId);
  if (existing) {
    const updated = await client
      .from('customers')
      .update({
        full_name: input.fullName || existing.full_name,
        email: input.email ?? existing.email,
        phone: input.phone ?? existing.phone,
      })
      .eq('id', existing.id)
      .select('*')
      .single<CustomerRow>();
    if (updated.error) throw new Error(`upsertOwnCustomer update: ${updated.error.message}`);
    return updated.data;
  }
  const inserted = await client
    .from('customers')
    .insert({
      brand_id: input.brandId,
      user_id: input.userId,
      full_name: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
    })
    .select('*')
    .single<CustomerRow>();
  if (inserted.error) throw new Error(`upsertOwnCustomer insert: ${inserted.error.message}`);
  return inserted.data;
}
