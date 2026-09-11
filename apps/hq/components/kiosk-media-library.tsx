import Link from 'next/link';
import type { KioskMenuFacts } from '@platform/domain';

import { ManagedThumbnail } from '@/components/managed-thumbnail';

export function KioskMediaLibrary({ menu }: { menu: KioskMenuFacts }) {
  const images = Object.entries(menu.imageUrls ?? {})
    .sort(([left], [right]) => left.localeCompare(right));
  return (
    <div className="card kiosk-media-library">
      <div className="kiosk-media-heading">
        <div>
          <h2>Menu image sync</h2>
          <p className="subtitle">Kiosks use the same tenant-owned thumbnails as the customer menu.</p>
        </div>
        <Link className="button secondary" href="/catalog">Manage catalog</Link>
      </div>
      {images.length > 0 ? (
        <div className="kiosk-media-grid" aria-label={`${images.length} synchronized kiosk thumbnails`}>
          {images.map(([slug, url]) => (
            <ManagedThumbnail
              key={slug}
              url={url}
              alt={`${slug.replaceAll('-', ' ')} kiosk thumbnail`}
              className="kiosk-media-thumb"
            />
          ))}
        </div>
      ) : <div className="notice">No menu pictures are available yet. Add them in Content → Menu.</div>}
    </div>
  );
}
