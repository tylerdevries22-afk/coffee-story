import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  LoyaltyAccountRow, LoyaltyEventRow, LoyaltyStandingRow, StoredValueLedgerRow,
} from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

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
  const account = await readWithRetry('fetchLoyaltySummary account', (signal) => abortRead(client
    .from('loyalty_accounts')
    .select('*')
    .eq('customer_id', customerId), signal)
    .maybeSingle<LoyaltyAccountRow>());

  const [ledger, storedValue] = await Promise.all([
    account
      ? readWithRetry('fetchLoyaltySummary ledger', (signal) => abortRead(client
          .from('loyalty_events')
          .select('*')
          .eq('account_id', account.id)
          .order('created_at', { ascending: false })
          .limit(ledgerLimit), signal)
          .returns<LoyaltyEventRow[]>())
      : Promise.resolve([] as LoyaltyEventRow[]),
    readWithRetry('fetchLoyaltySummary stored value', (signal) => abortRead(client
      .from('stored_value_ledger')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(ledgerLimit), signal)
      .returns<StoredValueLedgerRow[]>()),
  ]);

  return {
    account,
    ledger: ledger ?? [],
    storedValue: storedValue ?? [],
    storedValueBalanceCents: storedValue?.[0]?.balance_after_cents ?? 0,
  };
}

/**
 * Where a guest stands, with both ladders' inputs.
 *
 * Reads `loyalty_standing` (0035) rather than `loyalty_accounts`, because the
 * annual figure is a rolling twelve-month sum over `loyalty_events` that no
 * column holds — computing it client-side would mean shipping the whole ledger
 * to do it, and shipping the whole ledger is how a rewards screen becomes a
 * data export.
 *
 * Null when the guest has no account yet, which is every guest until their
 * first order.
 */
export async function fetchLoyaltyStanding(
  client: SupabaseClient,
  customerId: string,
): Promise<LoyaltyStandingRow | null> {
  return readWithRetry('fetchLoyaltyStanding', (signal) => abortRead(client
    .from('loyalty_standing')
    .select('*')
    .eq('customer_id', customerId), signal)
    .maybeSingle<LoyaltyStandingRow>());
}
