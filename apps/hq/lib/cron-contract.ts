/**
 * The contract between `vercel.json` and the route files it schedules.
 *
 * Vercel Cron invokes a scheduled path with GET, always: there is no body to
 * send and no way to configure the method. A route that exports only POST
 * answers 405 to every tick, and nothing surfaces it -- Vercel does not retry
 * a 405 and the deployment reports no error, so the schedule looks healthy
 * from every angle except the work not happening. `/api/jobs/run` sat that way
 * in production: drops, campaigns, analytics rollups and retention, and the
 * whole operations maintenance path went unrun for the life of the schedule.
 */

export type CronEntry = { path: string; schedule: string };

/** Reads a route module's source for a scheduled path, or null if absent. */
export type RouteReader = (path: string) => string | null;

/**
 * Matches the two ways this codebase can name a handler: a function
 * declaration, or a const bound to another handler. A re-export list would
 * pass Next.js too, and is deliberately not matched -- narrower is safer here,
 * since a false negative fails the test and a false positive ships the 405.
 */
const GET_EXPORT = /export\s+(?:async\s+function|function|const)\s+GET\b/;

/** The scheduled paths whose route either is missing or exports no GET. */
export function cronPathsMissingGet(
  crons: readonly CronEntry[],
  readRoute: RouteReader,
): string[] {
  return crons
    .filter((cron) => {
      const source = readRoute(cron.path);
      return source === null || !GET_EXPORT.test(source);
    })
    .map((cron) => cron.path);
}
