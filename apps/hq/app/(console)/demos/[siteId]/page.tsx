import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DemoLandingPage } from '@/components/demo/demo-landing';
import { Icon } from '@/components/icon';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, hasRole } from '@/lib/auth';
import { demoBuilder } from '@/lib/demo-builder';
import { demoLinkPath, demoLinkSecret } from '@/lib/demo-factory/link';
import { outreachOrigin, outreachSiteFromPack } from '@/lib/demo-factory/outreach-data';
import { demoLanding } from '@/lib/demo-pack';
import { log } from '@/lib/log';

import { OutreachPreview } from './outreach-preview';

import '../../../styles/demo.css';
import '../../../styles/demo-outreach.css';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string; state: string; business_name: string; expires_at: string; created_at: string;
  country_code: string | null; open_count: number; last_opened_at: string | null; pack: unknown;
};

/** The console's configured address, the one outreach drafts use, or else this request's. */
async function publicOrigin(): Promise<string> {
  const configured = outreachOrigin();
  if (configured) return configured;
  const list = await headers();
  const host = list.get('x-forwarded-host') ?? list.get('host') ?? '';
  return host ? `https://${host}` : '';
}

/**
 * One demo as its prospect will see it, with the link to send them. Rendered
 * here, behind the console's own sign-in, rather than through the link --
 * which would count the operator's look as the prospect's.
 */
export default async function DemoPreviewPage({ params }: { params: Promise<{ siteId: string }> }) {
  const [session, { siteId }] = await Promise.all([currentSession(), params]);
  if (!hasRole(session, 'platform_admin')) {
    return (
      <main className="factory-page">
        <div className="factory-empty"><Icon name="lock" size={22} /><strong>Platform administrator access required</strong></div>
      </main>
    );
  }
  if (!UUID.test(siteId)) notFound();
  const env = serverEnv();
  if (!env) return <main className="factory-page"><div className="notice">This deployment has no database connection.</div></main>;
  const read = await serviceDb(env).from('platform_demo_sites')
    .select('id,state,business_name,expires_at,created_at,country_code,open_count,last_opened_at,pack').eq('id', siteId).maybeSingle<Row>();
  if (read.error) {
    log.error('demo_factory.preview_failed', { siteId }, read.error);
    return <main className="factory-page"><div className="notice">The demo could not be read. Try again shortly.</div></main>;
  }
  if (!read.data) notFound();
  const site = read.data;
  const secret = demoLinkSecret();
  const path = secret ? demoLinkPath(secret, site.id) : null;
  const builder = demoBuilder();
  const link = path ? `${await publicOrigin()}${path}` : null;

  return (
    <main className="factory-page">
      <header className="factory-heading">
        <div>
          <p className="factory-eyebrow"><Link href="/demos">Demo factory</Link> · preview</p>
          <h1>{site.business_name}</h1>
          <p className="subtitle">
            {site.state} · opened {site.open_count} {site.open_count === 1 ? 'time' : 'times'}
            {site.last_opened_at ? `, last on ${site.last_opened_at.slice(0, 10)}` : ''} · expires {site.expires_at.slice(0, 10)}
          </p>
        </div>
      </header>
      {link ? (
        <label className="field">The link to send (opening it yourself counts as the prospect&apos;s open)
          <input readOnly value={link} />
        </label>
      ) : <div className="notice">Set DEMO_LINK_SECRET to see this demo&apos;s link.</div>}
      <OutreachPreview site={outreachSiteFromPack(site)} />
      {site.state === 'ready' && builder ? (
        <DemoLandingPage landing={demoLanding(site.pack, site.business_name)} builder={builder} removeHref={path ? `${path}/remove` : '#'} />
      ) : (
        <div className="notice">
          {site.state === 'ready' ? 'Set DEMO_BUILDER_NAME to render demos.' : `This demo is ${site.state}, so there is nothing to show.`}
        </div>
      )}
    </main>
  );
}
