/**
 * How many factory runs may build at once, and the queue behind that limit.
 *
 * Every run creates cloud objects -- a Supabase project, a GitHub repository,
 * a Doppler project, Vercel projects -- and each provider caps how many can be
 * made at once or in total; Supabase's per-organization project quota is the
 * first to refuse. Nothing in front of `start()` counted runs, so a burst of
 * new organizations would have met that quota halfway through provisioning,
 * with some of each run's resources already made.
 *
 * At the limit a run is not refused: it is recorded blocked with
 * `factory_busy`, and the scheduled job (`/api/jobs/run`) starts the one that
 * has waited longest as soon as a slot frees. The count is a soft limit --
 * two admins creating organizations in the same instant can both see the
 * last free slot -- which is acceptable for a path that runs once per signed
 * contract; the demo factory has its own brakes in the database.
 *
 * Go live is not throttled: it resumes a run an owner approved, and it only
 * attaches production hosts to projects the run already made.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const FACTORY_MAX_RUNNING = 3;
/**
 * A run's workflow updates its row at every stage; one untouched this long
 * is not holding a slot, its workflow is gone, and counting it would stall
 * the queue for good.
 */
export const FACTORY_STALE_MS = 6 * 60 * 60 * 1_000;
export const FACTORY_BUSY = 'factory_busy';

export type FactoryDb = Pick<SupabaseClient, 'from'>;
export type FactoryLaunch = (runId: string) => Promise<unknown>;

/** Runs building now, `except` one: running, and moved within the stale window. */
export async function factoryRunsBuilding(db: FactoryDb, now: Date, except?: string): Promise<number> {
  const since = new Date(now.getTime() - FACTORY_STALE_MS).toISOString();
  const building = db.from('platform_onboarding_runs').select('id', { count: 'exact', head: true })
    .eq('state', 'running').gt('updated_at', since);
  const result = except === undefined ? await building : await building.neq('id', except);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

/**
 * Hold `runId` for the queue when the factory is already full, and say so;
 * otherwise leave it for the caller to start. The run is the caller's to
 * have created or claimed, so it is never counted against itself.
 */
export async function holdIfFactoryFull(db: FactoryDb, runId: string, now = new Date()): Promise<boolean> {
  if (await factoryRunsBuilding(db, now, runId) < FACTORY_MAX_RUNNING) return false;
  const [run, tasks] = await Promise.all([
    db.from('platform_onboarding_runs').update({ state: 'blocked', last_error_code: FACTORY_BUSY })
      .eq('id', runId).in('state', ['draft', 'running', 'blocked', 'failed']),
    // Nothing is working on a held run, so no task of it may read as running.
    db.from('platform_onboarding_tasks').update({ state: 'pending' })
      .eq('run_id', runId).eq('state', 'running'),
  ]);
  if (run.error) throw run.error;
  if (tasks.error) throw tasks.error;
  return true;
}

/**
 * Start held runs, longest waiting first, while the factory has room. Each is
 * claimed by a conditional update before it starts, so two overlapping ticks
 * can never start one run twice. Returns how many started.
 */
export async function startHeldFactoryRuns(db: FactoryDb, launch: FactoryLaunch, now = new Date()): Promise<number> {
  const room = FACTORY_MAX_RUNNING - await factoryRunsBuilding(db, now);
  if (room <= 0) return 0;
  const held = await db.from('platform_onboarding_runs').select('id')
    .eq('state', 'blocked').eq('last_error_code', FACTORY_BUSY)
    .order('updated_at', { ascending: true }).limit(room);
  if (held.error) throw held.error;
  let started = 0;
  for (const { id } of (held.data ?? []) as { id: string }[]) {
    const claim = await db.from('platform_onboarding_runs').update({ state: 'running', last_error_code: null })
      .eq('id', id).eq('state', 'blocked').eq('last_error_code', FACTORY_BUSY).select('id').maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) continue;
    try {
      await launch(id);
      started += 1;
    } catch {
      const failed = await db.from('platform_onboarding_runs')
        .update({ state: 'failed', last_error_code: 'workflow_start_failed' }).eq('id', id);
      if (failed.error) throw failed.error;
    }
  }
  return started;
}
