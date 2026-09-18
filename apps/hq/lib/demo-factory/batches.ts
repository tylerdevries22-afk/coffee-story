/**
 * Starting, stopping and braking the demo factory from the console.
 *
 * A batch starts with Google's IDs-only text search, which is free: it names
 * the businesses, and the database decides which of them may be built before
 * anything billable happens -- a business that asked to be left alone, that
 * already has a live demo or that another batch is building is skipped there.
 * Nothing here builds a demo; the scheduled runner claims the queued jobs,
 * within the daily count and budget, only while the factory is switched on.
 */
import { log } from '../log';
import type { DemoFactoryDb } from './console-data';
import type { DemoBatchInput, DemoLimitsInput } from './console-input';
import { recordDemoCost } from './ledger';
import { estimateDemoMicrousd } from './prices';

/** Place ids for a text query, best match first; a Places failure throws. */
export type DemoPlaceSearch = (query: string, limit: number) => Promise<readonly string[]>;

export type DemoBatchFailure = 'places_unconfigured' | 'places_quota' | 'places_error' | 'database';

export type CreateDemoBatchResult =
  | { readonly kind: 'created'; readonly batchId: string; readonly found: number; readonly queued: number }
  | { readonly kind: 'failed'; readonly code: DemoBatchFailure };

function placesFailure(error: unknown): DemoBatchFailure {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 'unconfigured') return 'places_unconfigured';
  if (code === 'over_quota') return 'places_quota';
  return 'places_error';
}

function firstRow(data: unknown): Readonly<Record<string, unknown>> | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  return typeof row === 'object' && row !== null ? row as Readonly<Record<string, unknown>> : null;
}

export async function createDemoBatch(
  db: DemoFactoryDb,
  search: DemoPlaceSearch,
  input: DemoBatchInput,
  createdBy: string | null,
): Promise<CreateDemoBatchResult> {
  let placeIds: readonly string[];
  try {
    placeIds = await search(input.query, input.count);
  } catch (error) {
    return { kind: 'failed', code: placesFailure(error) };
  }
  const created = await db.rpc('create_platform_demo_batch', {
    p_query: input.query,
    p_requested: input.count,
    p_place_ids: placeIds.slice(0, input.count),
    p_unit_estimate_microusd: estimateDemoMicrousd(),
    p_created_by: createdBy,
  });
  const row = firstRow(created.data);
  const batchId = typeof row?.id === 'string' ? row.id : null;
  if (created.error || row === null || batchId === null) {
    if (created.error) log.error('demo_factory.batch_create_failed', {}, created.error);
    return { kind: 'failed', code: 'database' };
  }
  // The search is free and recorded anyway, so the ledger's request count can
  // be held against Google's as well as its dollar total.
  try {
    await recordDemoCost(db, { batchId, jobId: null }, {
      provider: 'google_places', sku: 'text_search_ids', quantity: 1,
    });
  } catch (error) {
    log.error('demo_factory.search_cost_unrecorded', { batchId }, error);
  }
  return { kind: 'created', batchId, found: Number(row.found) || 0, queued: Number(row.queued) || 0 };
}

/** The number of businesses skipped because they had not started. */
export async function stopDemoBatch(db: DemoFactoryDb, batchId: string): Promise<number> {
  const stopped = await db.rpc('stop_platform_demo_batch', { p_batch_id: batchId });
  if (stopped.error) throw stopped.error;
  return Number(stopped.data) || 0;
}

export type DemoSettingsPatch = { readonly enabled: boolean } | DemoLimitsInput;

/** The switch and the limits change separately, so turning it off never touches them. */
export async function updateDemoSettings(
  db: DemoFactoryDb,
  patch: DemoSettingsPatch,
  updatedBy: string | null,
): Promise<void> {
  const columns = 'enabled' in patch
    ? { enabled: patch.enabled }
    : { daily_limit: patch.dailyLimit, daily_budget_microusd: patch.dailyBudgetMicrousd };
  const { error } = await db.from('platform_demo_settings')
    .update({ ...columns, updated_by: updatedBy })
    .eq('singleton', true);
  if (error) throw error;
}
