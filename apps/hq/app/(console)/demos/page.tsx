import { Icon } from '@/components/icon';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, hasRole } from '@/lib/auth';
import { demoFactoryReadiness, loadDemoConsole, type DemoConsole } from '@/lib/demo-factory/console-data';
import { log } from '@/lib/log';

import { DemoBatchForm, DemoBatchList } from './batch-panels';
import { DemoDailyCosts } from './daily-costs';
import { DemoFactoryControls } from './controls';
import { DemoNotices } from './notices';
import { DemoRecentSites } from './recent-demos';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The demo factory: search for businesses, watch each one become a private
 * demo, and see what every one of them cost. Drafts of outreach live
 * elsewhere, and nothing on this page sends anything to anyone.
 */
export default async function DemosPage({ searchParams }: { searchParams: SearchParams }) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (!hasRole(session, 'platform_admin')) {
    return (
      <main className="factory-page">
        <div className="factory-empty">
          <Icon name="lock" size={22} />
          <strong>Platform administrator access required</strong>
          <p>The demo factory spends money and builds pages about real businesses.</p>
        </div>
      </main>
    );
  }

  const env = serverEnv();
  let data: DemoConsole | null = null;
  let unavailable = env === null;
  if (env) {
    try {
      data = await loadDemoConsole(serviceDb(env));
    } catch (error) {
      log.error('demo_factory.console_load_failed', {}, error);
      unavailable = true;
    }
  }

  return (
    <main className="factory-page">
      <header className="factory-heading">
        <div>
          <p className="factory-eyebrow">Platform</p>
          <h1>Demo factory</h1>
          <p className="subtitle">
            Turns a search into private demos, one per business, from each business&apos;s Google listing and
            its own website. Every call it pays for is on the ledger below. Nothing here sends email.
          </p>
        </div>
      </header>

      <DemoNotices params={params} />
      {unavailable ? (
        <div className="notice" role="status">
          The demo tables are not reachable from this deployment. Configure the database and apply the demo
          migrations to run the factory.
        </div>
      ) : null}

      <DemoFactoryControls settings={data?.settings ?? null} readiness={demoFactoryReadiness()} />
      <DemoBatchForm disabled={data === null} />
      <DemoBatchList batches={data?.batches ?? []} />
      <DemoRecentSites sites={data?.sites ?? []} />
      <DemoDailyCosts days={data?.daily ?? []} />
    </main>
  );
}
