/**
 * Appends one priced line to the demo factory's cost ledger.
 *
 * The price is fixed here, when the call is made, and stored as an integer;
 * the table refuses updates and deletes, so what the factory spent cannot be
 * revised afterwards -- only reconciled.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { lineCostMicrousd, type DemoCostLine } from './prices';

export type DemoLedgerDb = Pick<SupabaseClient, 'from'>;

export type DemoCostOwner = { readonly batchId: string; readonly jobId: string | null };

export type DemoCostRow = {
  readonly batch_id: string;
  readonly job_id: string | null;
  readonly provider: DemoCostLine['provider'];
  readonly sku: string;
  readonly model: string | null;
  readonly quantity: number;
  readonly cost_microusd: number;
};

// The column's own shape. A model name outside it is still recorded, as
// `unknown` and at the dearest price, rather than failing the insert and
// leaving a paid call off the books.
const MODEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function modelOf(line: DemoCostLine): string | null {
  if (line.provider !== 'openai') return null;
  const model = line.model.trim().toLowerCase();
  return MODEL.test(model) ? model : 'unknown';
}

export function demoCostRow(owner: DemoCostOwner, line: DemoCostLine): DemoCostRow {
  const model = modelOf(line);
  // Priced by the name that is stored, so the row and its price always agree.
  const priced: DemoCostLine = line.provider === 'openai' ? { ...line, model: model ?? 'unknown' } : line;
  return {
    batch_id: owner.batchId,
    job_id: owner.jobId,
    provider: line.provider,
    sku: line.sku,
    model,
    quantity: Number.isFinite(line.quantity) && line.quantity > 0 ? Math.trunc(line.quantity) : 0,
    cost_microusd: lineCostMicrousd(priced),
  };
}

/** Throws on failure: a call that cannot be accounted for must not look free. */
export async function recordDemoCost(db: DemoLedgerDb, owner: DemoCostOwner, line: DemoCostLine): Promise<number> {
  const row = demoCostRow(owner, line);
  const { error } = await db.from('platform_demo_costs').insert(row);
  if (error) throw error;
  return row.cost_microusd;
}
