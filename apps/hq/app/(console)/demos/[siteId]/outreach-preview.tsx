import { demoLinkPath } from '@/lib/demo-factory/link';
import { outreachReadiness } from '@/lib/demo-factory/outreach-data';
import { outreachDraft, type OutreachSite, type OutreachSkip } from '@/lib/demo-factory/outreach-draft';

import { OutreachSample } from '../outreach/outreach-sample';

const REASONS: Readonly<Record<OutreachSkip, string>> = {
  not_ready: 'This demo is not ready, so it has no outreach draft.',
  outside_us: 'This business is outside the US, so it gets no outreach draft.',
  no_email: 'The business’s website publishes no address to write to, so there is no draft. The link above can still be shared by hand.',
  expiring: 'This demo’s link expires within two days, so it gets no outreach draft.',
};

/** This demo's outreach draft, exactly as the day's file will carry it, or why it has none. */
export function OutreachPreview({ site }: { site: OutreachSite }) {
  const { sender, origin, linkSecret, missing } = outreachReadiness();
  if (!sender || !origin || !linkSecret) {
    return <div className="notice">Outreach drafts need {missing.join(', ')} before they can be written.</div>;
  }
  const decision = outreachDraft(site, sender, `${origin}${demoLinkPath(linkSecret, site.id)}`);
  if (!decision.ok) return <div className="notice">{REASONS[decision.reason]}</div>;
  return <OutreachSample draft={decision.draft} title="Its outreach draft" />;
}
