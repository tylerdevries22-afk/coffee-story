import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';

import { hqTheme } from '@/lib/theme';
import { lobbyScreen, type LobbyScreen } from '@/lib/lobby-screen';

import '../../../styles/lobby.css';

/**
 * One property's lobby screen.
 *
 * Unattended, landscape, and nobody's account: a guest walks up to it, reads,
 * and walks away. There is no sign-in, no cart and no control that charges
 * anyone, which is why it can be served publicly while the console around it
 * cannot.
 *
 * Every colour comes from `hqTheme(brandConfig)` -- the tenant's own tokens --
 * so two branches of two chains are two different screens without a line of
 * per-tenant styling. Rule 4 in CLAUDE.md, enforced by `pnpm audit:tokens`.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; locationId: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug, locationId } = await params;
  const screen = lobbyScreen(slug, locationId);
  return { title: screen ? `${screen.branch.name} — ${screen.brandName}` : 'Lobby' };
}

/** A sticky-nav label, or the section's own id turned into words. */
function anchorLabel(section: LobbyScreen['sections'][number]): string | null {
  return section.label;
}

function Hero({ screen }: { screen: LobbyScreen }) {
  return (
    <header className="lobby-hero" id="lobby-hero-planner">
      <p className="lobby-eyebrow">{screen.brandName}</p>
      <h1 className="lobby-title">{screen.branch.name}</h1>
      {screen.tagline ? <p className="lobby-tagline">{screen.tagline}</p> : null}
      <address className="lobby-address">
        {screen.address.map((line) => <span key={line}>{line}</span>)}
      </address>
      {screen.note ? <p className="lobby-note">{screen.note}</p> : null}
    </header>
  );
}

function Stats({ screen }: { screen: LobbyScreen }) {
  // Only facts this repo actually holds. Room count and rating live on the
  // partner's published page; inventing them for a demo would put a number in
  // front of a guest that no system stands behind.
  const stats = [
    { label: 'Property', value: screen.branch.name },
    { label: 'In the chain', value: `${screen.siblings.length} properties` },
    { label: 'Local time zone', value: screen.branch.timezone },
  ];
  return (
    <dl className="lobby-stats" id="lobby-stats" aria-label="At a glance">
      {stats.map((stat) => (
        <div className="lobby-stat" key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ContactHours({ screen }: { screen: LobbyScreen }) {
  return (
    <section className="lobby-panel" id="lobby-contact-hours" aria-label="Front desk and hours">
      <h2 className="lobby-panel-title">Front desk</h2>
      <dl className="lobby-hours">
        {screen.weekly.map((entry) => (
          <div className="lobby-hours-row" key={entry.day}>
            <dt>{entry.day}</dt>
            <dd>{entry.span}</dd>
          </div>
        ))}
      </dl>
      {screen.website ? <p className="lobby-contact">{screen.website}</p> : null}
    </section>
  );
}

/**
 * A section whose content is polled from the partner rather than carried here.
 *
 * It says so plainly instead of rendering an empty rail. A lobby screen that
 * showed a blank "What's on" would read as a broken app; one that says the feed
 * has not arrived is legible to the front-desk staff who have to look at it all
 * day.
 */
function Pending({ id, title, detail }: { id: string; title: string; detail: string }) {
  return (
    <section className="lobby-panel lobby-pending" id={`lobby-${id}`} aria-label={title}>
      <h2 className="lobby-panel-title">{title}</h2>
      <p className="lobby-pending-detail">{detail}</p>
    </section>
  );
}

function Explore({ screen }: { screen: LobbyScreen }) {
  return (
    <section className="lobby-panel" id="lobby-explore-map" aria-label="Explore">
      <h2 className="lobby-panel-title">Explore</h2>
      <p className="lobby-pending-detail">
        {screen.placeId
          ? 'Map centred on this property’s listing.'
          : `Listing not yet resolved. Looking up “${screen.placeQuery ?? screen.branch.name}”.`}
      </p>
    </section>
  );
}

const PENDING: Readonly<Record<string, { title: string; detail: string }>> = {
  'events-calendar': {
    title: 'What’s on',
    detail: 'Events are read live from the network rather than stored here, so this fills in once the property’s page is connected.',
  },
  rails: {
    title: 'Around the property',
    detail: 'Curated by the property on its own page; polled rather than cached.',
  },
  nearby: {
    title: 'Nearby',
    detail: 'Activities near this property, read live from the network.',
  },
};

export default async function LobbyPage({ params }: Params) {
  const { slug, locationId } = await params;
  const screen = lobbyScreen(slug, locationId);
  if (!screen) notFound();
  const nav = screen.sections.filter((section) => anchorLabel(section) !== null);
  return (
    <main className="lobby" style={hqTheme(screen.brandConfig) as CSSProperties}>
      <nav className="lobby-nav" aria-label="Sections">
        {nav.map((section) => (
          <a className="lobby-nav-link" href={`#lobby-${section.id}`} key={section.id}>
            {section.label}
          </a>
        ))}
      </nav>
      {screen.sections.map((section) => {
        if (section.id === 'hero-planner') return <Hero key={section.id} screen={screen} />;
        if (section.id === 'stats') return <Stats key={section.id} screen={screen} />;
        if (section.id === 'contact-hours') return <ContactHours key={section.id} screen={screen} />;
        if (section.id === 'explore-map') return <Explore key={section.id} screen={screen} />;
        const pending = PENDING[section.id];
        return pending
          ? <Pending key={section.id} id={section.id} title={pending.title} detail={pending.detail} />
          : null;
      })}
      <footer className="lobby-foot">
        <span>{screen.brandName}</span>
        <span>{screen.branch.city}</span>
      </footer>
    </main>
  );
}
