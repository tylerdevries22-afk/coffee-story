/**
 * What POST /api/demos/outreach does once the console gate has admitted a
 * platform admin: one day's drafts as a CSV attachment.
 *
 * A refusal the operator can act on sends them back to /demos/outreach with a
 * reason, so a form post never lands on a bare error page. The log line
 * carries counts only; the file is the one place the addresses go.
 */
import { log } from '../log';
import type { DemoFactoryDb } from './console-data';
import type { DemoConsoleContext } from './console-request';
import { outreachCsv, outreachFileName } from './outreach-csv';
import { loadOutreachSites, outreachDay, outreachDrafts, outreachReadiness } from './outreach-data';

export type OutreachExportDeps = {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The service client, or null on a deployment with no database. */
  readonly db: () => DemoFactoryDb | null;
  readonly now?: () => Date;
};

export type OutreachExportError = 'invalid_day' | 'not_ready' | 'unconfigured' | 'database';

function back(request: Request, error: OutreachExportError): Response {
  return Response.redirect(new URL(`/demos/outreach?error=${error}`, request.url), 303);
}

export async function outreachExport(
  request: Request, context: DemoConsoleContext, deps: OutreachExportDeps,
): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const form = await request.formData().catch(() => null);
  const day = outreachDay(form?.get('day'), now);
  if (!day) return back(request, 'invalid_day');
  const { sender, origin, linkSecret } = outreachReadiness(deps.env);
  if (!sender || !origin || !linkSecret) return back(request, 'not_ready');
  const db = deps.db();
  if (!db) return back(request, 'unconfigured');
  try {
    const batch = outreachDrafts(await loadOutreachSites(db, day, day), sender, origin, linkSecret, now);
    log.info('demo_factory.outreach_exported', {
      requestId: context.requestId, day, drafts: batch.drafts.length, ...batch.skipped,
    });
    return new Response(outreachCsv(batch.drafts, sender.name), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${outreachFileName(day)}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    log.error('demo_factory.outreach_export_failed', { requestId: context.requestId, day }, error);
    return back(request, 'database');
  }
}
