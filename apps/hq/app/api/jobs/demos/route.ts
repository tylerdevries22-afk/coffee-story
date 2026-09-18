import { randomUUID } from 'node:crypto';

import { placeDetails } from '@platform/engine';

import { jsonError, matchesSecret, notConfigured, serverEnv, serviceDb } from '../../../../lib/api-auth';
import { demoBuilder } from '../../../../lib/demo-builder';
import { demoLinkSecret } from '../../../../lib/demo-factory/link';
import { runDemoJobs, sweepExpiredDemos } from '../../../../lib/demo-factory/runner';
import { optionalExtractionConfig, siteKitReader } from '../../../../lib/demo-factory/site-kit-reader';
import { log } from '../../../../lib/log';
import { placesKey } from '../../../../lib/places-proxy-context';

export const maxDuration = 300;

/** Two businesses a run, every ten minutes: the daily count binds long before this does. */
const JOBS_PER_RUN = 2;
const LEASE_SECONDS = 300;
/** A listing, its website read by a model, and its logo: SITE_KIT_LIMITS is what keeps this enough. */
const JOB_MS = 120_000;
/** No job starts after this much of the run, so a slow one still finishes inside maxDuration. */
const START_WINDOW_MS = 150_000;

/**
 * The demo factory's scheduled run, reached as GET from Vercel Cron and as
 * POST by hand, with the same bearer secret the maintenance tick uses.
 *
 * Expired demos are swept on every run, whatever else is configured. Work is
 * only claimed when a job could finish: without a Places key, a link secret
 * and a builder name, every claimed job would spend an attempt failing, so
 * the run reports what is missing instead.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError(501, 'not_configured', 'CRON_SECRET is not set on this deployment.');
  if (!matchesSecret(request.headers.get('authorization'), `Bearer ${secret}`)) {
    return jsonError(401, 'unauthorized', 'Bad cron secret.');
  }
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const started = Date.now();

  let expired: number | null = null;
  try {
    expired = await sweepExpiredDemos(db);
  } catch (error) {
    log.error('demo_factory.sweep_failed', {}, error);
  }

  const apiKey = placesKey();
  const linkSecret = demoLinkSecret();
  const missing = [
    ...(apiKey ? [] : ['GOOGLE_PLACES_API_KEY']),
    ...(linkSecret ? [] : ['DEMO_LINK_SECRET']),
    ...(demoBuilder() ? [] : ['DEMO_BUILDER_NAME']),
  ];
  if (!apiKey || !linkSecret || missing.length > 0) {
    return Response.json({ ok: true, expired, building: 'not_ready', missing });
  }
  try {
    const summary = await runDemoJobs({
      db,
      details: (placeId, signal) => placeDetails(placeId, { apiKey, signal }),
      // Without a model the crawl still gives a demo its colors, logo and
      // contact address; the menu is then the labelled sample.
      readKit: siteKitReader({ storage: db, extraction: optionalExtractionConfig(), now: Date.now }),
      linkSecret,
      newSiteId: randomUUID,
    }, {
      limit: JOBS_PER_RUN,
      leaseSeconds: LEASE_SECONDS,
      jobMs: JOB_MS,
      deadline: started + START_WINDOW_MS,
      now: Date.now,
    });
    return Response.json({ ok: true, expired, ...summary });
  } catch (error) {
    log.error('demo_factory.run_failed', {}, error);
    return jsonError(500, 'run_failed', 'The demo run could not claim work; nothing was built.');
  }
}

/** Vercel Cron calls with GET; lib/cron-contract.test.ts holds every schedule to it. */
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
