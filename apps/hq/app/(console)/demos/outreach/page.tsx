import Link from 'next/link';

import { Icon } from '@/components/icon';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, hasRole } from '@/lib/auth';
import { loadOutreachSites, outreachDrafts, outreachReadiness } from '@/lib/demo-factory/outreach-data';
import type { OutreachDraft, OutreachSite } from '@/lib/demo-factory/outreach-draft';
import { outreachDaySummaries, outreachRange } from '@/lib/demo-factory/outreach-summary';
import { log } from '@/lib/log';

import { OutreachDays } from './outreach-days';
import { OutreachReadinessPanel } from './outreach-readiness';
import { OutreachSample } from './outreach-sample';

import '../../../styles/demo-outreach.css';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ERRORS: Readonly<Record<string, string>> = {
  invalid_day: 'That day is outside the last fourteen, so none of its demos can still be sent.',
  not_ready: 'Drafts cannot be exported until every setting below is configured.',
  unconfigured: 'This deployment has no database connection, so there is nothing to export.',
  database: 'The demos could not be read. Nothing was exported; try again shortly.',
};

/**
 * Outreach drafts: a first email for every demo whose business publishes an
 * address, one CSV per day, for the operator's own sending tool. HQ never
 * sends them -- there is no send button here to press.
 */
export default async function DemoOutreachPage({ searchParams }: { searchParams: SearchParams }) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (!hasRole(session, 'platform_admin')) {
    return (
      <main className="factory-page">
        <div className="factory-empty"><Icon name="lock" size={22} /><strong>Platform administrator access required</strong></div>
      </main>
    );
  }

  const readiness = outreachReadiness();
  const env = serverEnv();
  let sites: OutreachSite[] | null = null;
  if (env) {
    const { from, to } = outreachRange();
    try {
      sites = await loadOutreachSites(serviceDb(env), from, to);
    } catch (error) {
      log.error('demo_factory.outreach_load_failed', {}, error);
    }
  }
  const { sender, origin, linkSecret } = readiness;
  const sample: OutreachDraft | null = sites && sender && origin && linkSecret
    ? outreachDrafts(sites, sender, origin, linkSecret).drafts.at(-1) ?? null
    : null;
  const error = typeof params.error === 'string' ? ERRORS[params.error] : undefined;

  return (
    <main className="factory-page">
      <header className="factory-heading">
        <div>
          <p className="factory-eyebrow"><Link href="/demos">Demo factory</Link> · outreach</p>
          <h1>Outreach drafts</h1>
          <p className="subtitle">
            A first email for every demo whose business publishes an address on its own website, one file per
            day, to import into your own sending tool. HQ never sends them.
          </p>
        </div>
      </header>
      {error ? <div className="notice factory-notice-danger" role="alert">{error}</div> : null}
      {sites === null ? (
        <div className="notice" role="status">
          The demo tables are not reachable from this deployment, so there are no drafts to show.
        </div>
      ) : null}
      <OutreachReadinessPanel missing={readiness.missing} />
      <OutreachDays days={outreachDaySummaries(sites ?? [])} ready={readiness.missing.length === 0} />
      {sample ? <OutreachSample draft={sample} /> : null}
    </main>
  );
}
