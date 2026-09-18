/**
 * The scheduled demo run: forget what has expired, then build what the
 * brakes allow.
 *
 * The expiry sweep runs whatever the switch says -- two weeks is a promise
 * made on every demo page, not a feature of the factory being on. Building
 * asks the database for work, which hands out none while the factory is off
 * or today's count or budget is spent, and each job it gets has its own
 * deadline inside the run's, so one slow website cannot starve the rest.
 */
import { removeDemoMedia, type DemoDb } from '../demo-site';
import { log } from '../log';
import { buildDemoJob, type ClaimedDemoJob, type DemoJobDeps, type DemoJobOutcome } from './job-build';

export type DemoRunOptions = {
  /** Jobs to claim this run; the database clamps it again. */
  readonly limit: number;
  readonly leaseSeconds: number;
  readonly jobMs: number;
  /** Epoch ms after which no new job starts; it is handed back instead. */
  readonly deadline: number;
  readonly now: () => number;
};

export type DemoRunSummary = {
  readonly claimed: number;
  readonly built: number;
  readonly skipped: number;
  readonly failed: number;
  readonly retried: number;
};

type Row = Readonly<Record<string, unknown>>;

function rows(data: unknown): Row[] {
  return Array.isArray(data) ? data.filter((row): row is Row => typeof row === 'object' && row !== null) : [];
}

export function claimedJob(row: Row): ClaimedDemoJob | null {
  const { id, batch_id: batchId, google_place_id: placeId, attempt, created_by: createdBy } = row;
  if (typeof id !== 'string' || typeof batchId !== 'string' || typeof placeId !== 'string') return null;
  if (typeof attempt !== 'number' || !Number.isInteger(attempt)) return null;
  return { id, batchId, placeId, attempt, createdBy: typeof createdBy === 'string' ? createdBy : null };
}

async function withDeadline(job: ClaimedDemoJob, deps: DemoJobDeps, jobMs: number): Promise<DemoJobOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), jobMs);
  try {
    return await buildDemoJob(job, deps, controller.signal);
  } catch (error) {
    log.error('demo_factory.job_failed', { jobId: job.id }, error);
    return { state: 'queued', outcome: controller.signal.aborted ? 'timed_out' : 'unexpected' };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDemoJobs(deps: DemoJobDeps, options: DemoRunOptions): Promise<DemoRunSummary> {
  const claimed = await deps.db.rpc('claim_platform_demo_jobs', {
    p_limit: options.limit, p_lease_seconds: options.leaseSeconds,
  });
  if (claimed.error) throw claimed.error;
  const jobs = rows(claimed.data).map(claimedJob).filter((job): job is ClaimedDemoJob => job !== null);
  const tally = { built: 0, skipped: 0, failed: 0, retried: 0 };
  for (const job of jobs) {
    const outcome: DemoJobOutcome = options.now() >= options.deadline
      ? { state: 'queued', outcome: 'out_of_time' }
      : await withDeadline(job, deps, options.jobMs);
    const built = outcome.state === 'built';
    const finished = await deps.db.rpc('finish_platform_demo_job', {
      p_job_id: job.id,
      p_attempt: job.attempt,
      p_state: outcome.state,
      p_outcome: built ? null : outcome.outcome,
      p_site_id: built ? outcome.siteId : null,
    });
    // False means another attempt holds the lease now; its result stands.
    if (finished.error || finished.data !== true) {
      log.error('demo_factory.finish_lost', { jobId: job.id, attempt: job.attempt }, finished.error ?? undefined);
    }
    if (outcome.state === 'built') tally.built += 1;
    else if (outcome.state === 'skipped') tally.skipped += 1;
    else if (outcome.state === 'failed') tally.failed += 1;
    else tally.retried += 1;
  }
  return { claimed: jobs.length, ...tally };
}

/**
 * Expires demos past their window and deletes their images. An image that
 * will not delete is logged for a person: the row is already expired and its
 * pack gone, so the page shows nothing, but the file should not outlive it.
 */
export async function sweepExpiredDemos(db: DemoDb, limit = 200): Promise<number> {
  const expired = await db.rpc('expire_platform_demo_sites', { p_limit: limit });
  if (expired.error) throw expired.error;
  const ids = rows(expired.data).map((row) => row.id).filter((id): id is string => typeof id === 'string');
  for (const id of ids) {
    try {
      await removeDemoMedia(db, id);
    } catch (error) {
      log.error('demo_factory.expired_media_kept', { siteId: id }, error);
    }
  }
  return ids.length;
}
