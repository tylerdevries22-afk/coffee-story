/**
 * POST /api/demos/outreach -- one day's outreach drafts as a CSV download,
 * for the operator to import into their own sending tool. Nothing here sends
 * email.
 *
 * Form body: `day=YYYY-MM-DD`, a UTC day within the last fourteen. A read
 * with no side effects -- drafts are derived, never stored -- but a POST all
 * the same, because the file carries the addresses businesses publish, and
 * only a POST carries the Origin header the console gate checks. See
 * lib/demo-factory/console-request.ts for who may call this and how often,
 * and lib/demo-factory/outreach-export.ts for what it answers.
 */
import { serverEnv, serviceDb } from '../../../../lib/api-auth';
import { currentSession } from '../../../../lib/auth';
import { demoConsoleContext } from '../../../../lib/demo-factory/console-request';
import { outreachExport } from '../../../../lib/demo-factory/outreach-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const context = await demoConsoleContext(request, 'outreach', { session: currentSession });
  if (context instanceof Response) return context;
  return outreachExport(request, context, {
    env: process.env,
    db: () => {
      const env = serverEnv();
      return env ? serviceDb(env) : null;
    },
  });
}
