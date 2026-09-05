import { NextResponse } from 'next/server';
import { isConfigured, isLocationId, loadActivityBoardItems } from '@/lib/board';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ location: string }> },
) {
  const { location } = await params;
  if (isConfigured() && !isLocationId(location)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json(await loadActivityBoardItems(location), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('display: activity reconcile failed', error);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
