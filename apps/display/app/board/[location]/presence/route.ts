import { NextResponse } from 'next/server';

import { isConfigured, isLocationId } from '@/lib/board';
import { recordDeviceWallPresence } from '@/lib/device-wall-presence';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ location: string }> },
) {
  const { location } = await params;
  if (!isConfigured() || !isLocationId(location)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const recorded = await recordDeviceWallPresence(location);
  return NextResponse.json({ recorded }, {
    status: recorded ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
