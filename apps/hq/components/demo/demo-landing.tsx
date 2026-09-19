import type { CSSProperties } from 'react';

import { formatMoney } from '@platform/domain';

import type { DemoBuilder } from '@/lib/demo-builder';
import type { DemoLanding, DemoMenuSection } from '@/lib/demo-pack';
import { hqTheme } from '@/lib/theme';

import { DemoBanner } from './demo-banner';

/**
 * A prospect's first look at their own demo.
 *
 * Coloured entirely by the business's own tokens through `hqTheme` -- the
 * stylesheet names no colour (rule 4) -- so the page is theirs before a
 * single app is opened. Images come through `/d/media/`, which re-checks the
 * link's cookie, the demo's state and its expiry on every request.
 */
function media(name: string): string {
  return `/d/media/${encodeURIComponent(name)}`;
}

function Menu({ sections, sample }: { sections: readonly DemoMenuSection[]; sample: boolean }) {
  if (sections.length === 0) return null;
  return (
    <section className="demo-section" aria-labelledby="demo-menu-title">
      <h2 className="demo-section-title" id="demo-menu-title">
        {sample ? 'A sample menu, standing in for yours' : 'Your menu, already in the app'}
      </h2>
      {sample ? (
        <p className="demo-section-note">We could not read your menu from your website, so these items are placeholders.</p>
      ) : null}
      {sections.map((section, sectionIndex) => (
        <div className="demo-menu-group" key={`${sectionIndex}-${section.title}`}>
          <h3 className="demo-menu-heading">{section.title}</h3>
          <ul className="demo-menu-list">
            {section.items.map((item, itemIndex) => (
              <li className="demo-menu-item" key={`${itemIndex}-${item.id}`}>
                {item.image ? <img className="demo-menu-image" src={media(item.image)} alt="" loading="lazy" /> : null}
                <div className="demo-menu-text">
                  <p className="demo-menu-name">{item.name}</p>
                  {item.description ? <p className="demo-menu-description">{item.description}</p> : null}
                </div>
                {item.priceCents === null ? null : <p className="demo-menu-price">{formatMoney(item.priceCents)}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Listing({ landing }: { landing: DemoLanding }) {
  const links = [
    landing.website ? { href: landing.website, label: 'Website' } : null,
    landing.mapsUri ? { href: landing.mapsUri, label: 'Google Maps' } : null,
    landing.reviewsUri ? { href: landing.reviewsUri, label: 'Reviews' } : null,
  ].filter((link) => link !== null);
  if (!landing.address && landing.hours.length === 0 && !landing.phone && links.length === 0) return null;
  return (
    <section className="demo-section" aria-labelledby="demo-listing-title">
      <h2 className="demo-section-title" id="demo-listing-title">From your Google listing</h2>
      {landing.address ? <p className="demo-listing-line">{landing.address}</p> : null}
      {landing.phone ? <p className="demo-listing-line">{landing.phone}</p> : null}
      {landing.hours.length > 0 ? (
        <ul className="demo-hours">
          {landing.hours.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      ) : null}
      {links.length > 0 ? (
        <p className="demo-links">
          {links.map((link) => (
            <a className="demo-link" key={link.label} href={link.href} rel="noopener noreferrer nofollow" target="_blank">
              {link.label}
            </a>
          ))}
        </p>
      ) : null}
    </section>
  );
}

export function DemoLandingPage({ landing, builder, removeHref }: {
  landing: DemoLanding;
  builder: DemoBuilder;
  removeHref: string;
}) {
  return (
    <main className="demo" style={hqTheme(landing.brandConfig) as CSSProperties}>
      <DemoBanner builder={builder} businessName={landing.name} removeHref={removeHref} />
      <header className="demo-hero">
        {landing.logo ? <img className="demo-logo" src={media(landing.logo)} alt={`${landing.name} logo`} /> : null}
        <p className="demo-eyebrow">A demo made for</p>
        <h1 className="demo-title">{landing.name}</h1>
        {landing.tagline ? <p className="demo-tagline">{landing.tagline}</p> : null}
        <p className="demo-hero-actions">
          <a className="demo-hero-button demo-hero-button-primary" href="/demo/customer/">
            Open the app
          </a>
          <a className="demo-hero-button demo-hero-button-secondary" href="/demo/kiosk/">
            See the in-store kiosk
          </a>
        </p>
      </header>
      <Menu sections={landing.menu} sample={landing.menuSample} />
      <Listing landing={landing} />
      <section className="demo-section demo-cta" aria-labelledby="demo-cta-title">
        <h2 className="demo-section-title" id="demo-cta-title">Want this for real?</h2>
        <p className="demo-cta-text">
          Ordering, pickup and a kiosk, under your name, with your menu. Nothing here is live
          and nobody can order from it yet.
        </p>
        {builder.contactHref ? (
          <a className="demo-cta-link" href={builder.contactHref}>Talk to {builder.name}</a>
        ) : null}
      </section>
    </main>
  );
}
