import { notFound } from 'next/navigation';

import { loadLocations } from '@/lib/data';
import { isWallLocationId } from '@/lib/wall';
import { loadWallPreviewTickets } from '@/lib/wall-preview';

import { WallPreview } from './wall-preview';

export const dynamic = 'force-dynamic';

export default async function WallPreviewPage({ params }: { params: Promise<{ location: string }> }) {
  const { location } = await params;
  if (!isWallLocationId(location)) notFound();

  const locations = await loadLocations();
  const selected = locations.find((candidate) => candidate.id === location);
  if (!selected) notFound();

  const tickets = await loadWallPreviewTickets(location);
  return <WallPreview initialTickets={tickets} locationId={location} locationName={selected.name} />;
}
