import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { DemoBanner, DemoNotice } from '@/components/demo/demo-banner';
import { DemoLandingPage } from '@/components/demo/demo-landing';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { demoBuilder } from '@/lib/demo-builder';
import { DEMO_COOKIE } from '@/lib/demo-entry';
import { demoLanding } from '@/lib/demo-pack';
import { viewDemoSite, type DemoSiteView } from '@/lib/demo-site';
import { isDemoToken } from '@/lib/demo-token';

import '../../styles/demo.css';

/**
 * Where a demo link lands once `/d/<token>` has moved the token into a
 * cookie. Unauthenticated and uncached: what renders is decided per request
 * by the token, the demo's state and its expiry, never by a session -- the
 * demo path cannot reach the console's demo session or anything it grants.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Demo',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

type Props = { searchParams: Promise<{ link?: string }> };

export default async function DemoView({ searchParams }: Props) {
  const { link } = await searchParams;
  const builder = demoBuilder();
  const env = serverEnv();
  if (link === 'unavailable' || !builder || !env) {
    return <DemoNotice title="Demos aren't available right now" body="Please try the link again later." />;
  }
  if (link === 'invalid') {
    return <DemoNotice title="That link isn't complete" body="Open the demo from the full link in your email." />;
  }
  const token = (await cookies()).get(DEMO_COOKIE)?.value ?? '';
  let site: DemoSiteView = { state: 'gone' };
  if (isDemoToken(token)) {
    try {
      site = await viewDemoSite(serviceDb(env), token);
    } catch {
      return <DemoNotice title="Demos aren't available right now" body="Please try the link again later." />;
    }
  }
  const removeHref = isDemoToken(token) ? `/d/${token}/remove` : null;
  if (site.state === 'expired') {
    return (
      <DemoNotice
        title={`This demo for ${site.businessName} has expired`}
        body="Demos are kept for two weeks. Ask for a fresh one if you'd like another look."
      >
        <DemoBanner builder={builder} businessName={site.businessName} removeHref={removeHref} />
      </DemoNotice>
    );
  }
  if (site.state === 'gone' || removeHref === null) {
    return <DemoNotice title="This demo isn't available" body="It may have been removed at the business's request." />;
  }
  return (
    <DemoLandingPage
      landing={demoLanding(site.pack, site.businessName)}
      builder={builder}
      removeHref={removeHref}
    />
  );
}
