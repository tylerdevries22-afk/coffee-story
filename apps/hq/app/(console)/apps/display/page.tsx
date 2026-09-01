import Link from 'next/link';

import { DevicePreviewFrame } from '@/components/device-preview-frame';
import { loadLocations } from '@/lib/data';
import { wallTargetFor } from '@/lib/wall';

export const dynamic = 'force-dynamic';

type DisplayPageProps = {
  searchParams: Promise<{ location?: string }>;
};

/** The location-aware queue display belongs with the other application surfaces. */
export default async function PickupDisplayPage({ searchParams }: DisplayPageProps) {
  const [locations, params] = await Promise.all([loadLocations(), searchParams]);
  const selected = locations.find((location) => location.id === params.location) ?? locations[0];

  if (!selected) {
    return (
      <div className="apps-page">
        <header className="apps-page-header">
          <div><p className="apps-eyebrow">Apps · Pickup display</p><h1>Queue</h1><p>Live pickup displays for this tenant.</p></div>
        </header>
        <section className="apps-empty-state">
          <h2>No locations configured</h2>
          <p>Add a location before opening its pickup queue.</p>
          <Link className="apps-external-link" href="/onboarding">Add a location</Link>
        </section>
      </div>
    );
  }

  const target = wallTargetFor(selected.id);
  const source = target.source === 'display' ? 'Live display' : target.source === 'hq' ? 'HQ live preview' : 'Preview wall';
  return (
    <div className="apps-page apps-surface apps-surface--tv">
      <nav className="apps-breadcrumb" aria-label="Breadcrumb"><Link href="/apps">Apps wall</Link><span aria-hidden="true">/</span><span>Pickup display</span></nav>
      <header className="apps-page-header apps-surface-header">
        <div><p className="apps-eyebrow">Wall display · {source}</p><h1>Queue</h1><p>Live pickup queue for {selected.name}. It uses the same tenant data as the in-store screen.</p></div>
        <a className="apps-external-link" href={target.url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
      </header>
      {locations.length > 1 ? (
        <nav className="apps-location-switcher" aria-label="Pickup display location">
          {locations.map((location) => (
            <Link className={location.id === selected.id ? 'active' : ''} href={`/apps/display?location=${encodeURIComponent(location.id)}`} key={location.id} aria-current={location.id === selected.id ? 'page' : undefined}>{location.name}</Link>
          ))}
        </nav>
      ) : null}
      <section className="apps-surface-frame" aria-label={`${selected.name} pickup display`}>
        <DevicePreviewFrame frame="tv" height={1080} src={target.url} title={`${selected.name} live pickup display`} width={1920} />
      </section>
    </div>
  );
}
