import type { ReactNode } from 'react';

import type { DemoBuilder } from '@/lib/demo-builder';

/**
 * The line every demo page carries, above everything else and with no way to
 * dismiss it: this is unofficial, this is who made it, and here is how the
 * business makes it go away for good. A demo that let a visitor believe the
 * business built it would be a misrepresentation, not a pitch.
 */
export function DemoBanner({ builder, businessName, removeHref }: {
  builder: DemoBuilder;
  businessName: string;
  removeHref: string | null;
}) {
  return (
    <aside className="demo-banner" role="note" aria-label="About this demo">
      <p className="demo-banner-text">
        <strong>Unofficial demo.</strong>{' '}
        {builder.name} built this to show what an ordering app for {businessName} could
        look like. {businessName} has not endorsed or reviewed it.
      </p>
      {removeHref ? (
        <a className="demo-banner-link" href={removeHref}>Remove my business</a>
      ) : null}
    </aside>
  );
}

/** A page with nothing to show but a sentence, still under the banner when there is one. */
export function DemoNotice({ title, body, children }: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <main className="demo demo-notice">
      {children}
      <section className="demo-notice-body">
        <h1 className="demo-notice-title">{title}</h1>
        <p className="demo-notice-text">{body}</p>
      </section>
    </main>
  );
}
