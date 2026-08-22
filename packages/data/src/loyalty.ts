import type { SupabaseClient } from '@supabase/supabase-js';

import type { LoyaltyAccountRow, LoyaltyEventRow, StoredValueLedgerRow } from '@platform/schema';

export type LoyaltySummary = {
  account: LoyaltyAccountRow | null;
  ledger: LoyaltyEventRow[];
  storedValue: StoredValueLedgerRow[];
  storedValueBalanceCents: number;
};

/**
 * Everything the rewards screen shows: the balance, the recent ledger, and
 * the stored-value history whose newest row carries the running balance.
 * Balances only ever move through the engine; these are read-only rows.
 */
export async function fetchLoyaltySummary(
  client: SupabaseClient,
  customerId: string,
  ledgerLimit = 50,
): Promise<LoyaltySummary> {
  const account = await client
    .from('loyalty_accounts')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle<LoyaltyAccountRow>();
  if (account.error) throw new Error(`fetchLoyaltySummary account: ${account.error.message}`);

  const [ledger, storedValue] = await Promise.all([
    account.data
      ? client
          .from('loyalty_events')
          .select('*')
          .eq('account_id', account.data.id)
          .order('created_at', { ascending: false })
          .limit(ledgerLimit)
          .returns<LoyaltyEventRow[]>()
      : Promise.resolve({ data: [] as LoyaltyEventRow[], error: null }),
    client
      .from('stored_value_ledger')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(ledgerLimit)
      .returns<StoredValueLedgerRow[]>(),
  ]);
  if (ledger.error) throw new Error(`fetchLoyaltySummary ledger: ${ledger.error.message}`);
  if (storedValue.error) throw new Error(`fetchLoyaltySummary stored value: ${storedValue.error.message}`);

  return {
    account: account.data,
    ledger: ledger.data ?? [],
    storedValue: storedValue.data ?? [],
    storedValueBalanceCents: storedValue.data?.[0]?.balance_after_cents ?? 0,
  };
}
