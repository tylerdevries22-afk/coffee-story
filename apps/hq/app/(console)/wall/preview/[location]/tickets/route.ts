import { NextResponse } from 'next/server';

import { isWallLocationId } from '@/lib/wall';
import { loadWallPreviewTickets } from '@/lib/wall-preview';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ location: string }> },
) {
  const { location } = await params;
  if (!isWallLocationId(location)) {
    return NextResponse.json({ error: 'invalid_location' }, { status: 400 });
  }

  try {
    const tickets = await loadWallPreviewTickets(location);
    return NextResponse.json(tickets, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'wall_unavailable' }, { status: 503 });
  }
}
