import Link from 'next/link';

import { loadLocations } from '@/lib/data';
import { wallTargetFor } from '@/lib/wall';

// The wall is tenant-scoped live data and must not be statically prerendered.
export const dynamic = 'force-dynamic';

type WallPageProps = {
  searchParams: Promise<{ location?: string }>;
};

export default async function WallPage({ searchParams }: WallPageProps) {
  const [locations, params] = await Promise.all([loadLocations(), searchParams]);
  const selected = locations.find((location) => location.id === params.location) ?? locations[0];

  if (!selected) {
    return (
      <>
        <h1>Wall</h1>
        <p className="subtitle">Live pickup displays for this tenant.</p>
        <section className="card wall-empty">
          <h2>No locations configured</h2>
          <p className="subtitle">Add a location before opening its pickup wall.</p>
          <Link className="button" href="/onboarding">Add a location</Link>
        </section>
      </>
    );
  }

  const target = wallTargetFor(selected.id);
  return (
    <>
      <div className="wall-heading">
        <div className="wall-heading-copy">
          <h1>Wall</h1>
          <p className="subtitle">Live pickup display for {selected.name}. It uses the same tenant data as the in-store screen.</p>
        </div>
        <a className="button secondary" href={target.url} target="_blank" rel="noopener noreferrer">
          Open in new tab
        </a>
      </div>

      <div className="wall-toolbar">
        {locations.length > 1 ? (
          <nav className="wall-locations" aria-label="Wall location">
            {locations.map((location) => (
              <Link
                className={`button secondary wall-location${location.id === selected.id ? ' active' : ''}`}
                href={`/wall?location=${encodeURIComponent(location.id)}`}
                key={location.id}
                aria-current={location.id === selected.id ? 'page' : undefined}
              >
                {location.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <span className="pill accent">
          {target.source === 'display' ? 'Live display' : target.source === 'hq' ? 'HQ live preview' : 'Preview wall'}
        </span>
      </div>

      <section className="card wall-frame-card" aria-label={`${selected.name} pickup wall`}>
        <iframe
          className="wall-iframe"
          src={target.url}
          title={`${selected.name} live pickup wall`}
          loading="eager"
          allow="fullscreen"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin"
        />
      </section>
    </>
  );
}
