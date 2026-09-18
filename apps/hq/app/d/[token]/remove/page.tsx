import type { Metadata } from 'next';

import { DemoNotice } from '@/components/demo/demo-banner';
import { isDemoToken } from '@/lib/demo-token';

import { removeDemo } from './actions';

import '../../../styles/demo.css';

/**
 * The confirmation step of "remove my business". Deliberately free of
 * database reads: anyone holding the link may remove the demo, including
 * after it expired, and the page must work even when demos themselves are
 * switched off -- honouring a removal cannot depend on the demo rendering.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Remove this demo',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

const STATUS: Readonly<Record<string, string>> = {
  busy: 'Too many requests just now. Wait a minute and press the button again.',
  unavailable: "We couldn't reach the demo service. Please try again shortly.",
  nothing: 'There was nothing left to remove: this demo is already gone.',
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function RemoveDemoPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { status } = await searchParams;
  if (!isDemoToken(token)) {
    return <DemoNotice title="That link isn't complete" body="Use the full removal link from your email." />;
  }
  const note = status ? STATUS[status] : undefined;
  return (
    <main className="demo demo-notice">
      <section className="demo-notice-body">
        <h1 className="demo-notice-title">Remove this demo</h1>
        <p className="demo-notice-text">
          This deletes the demo made for your business -- its name, menu, pictures and details
          -- and adds it to a list we check before making any demo, so we will not make one
          for your business again.
        </p>
        {note ? <p className="demo-notice-text" role="status">{note}</p> : null}
        <form action={removeDemo}>
          <input type="hidden" name="token" value={token} />
          <button className="demo-remove-button" type="submit">Remove my business</button>
        </form>
      </section>
    </main>
  );
}
