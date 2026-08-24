import { NextResponse } from 'next/server';

import { isConfigured, isLocationId, loadBoardTickets } from '@/lib/board';

/**
 * The board's reconcile read.
 *
 * A wall-mounted screen has nobody watching for a dropped socket, so the
 * display re-reads on a timer. Same loader as the page, so the two can never
 * disagree about what the board is.
 *
 * This route holds the device token on the server; the browser on the wall
 * never does. That is the trade this endpoint exists to make, and it is also
 * why it is guarded: without a check, a deployment with a token configured is
 * an unauthenticated proxy that will read out any location's queue to anyone
 * on the internet who can guess an id. The guest names on a board are meant
 * for the room they are standing in, not for a crawler.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ location: string }> },
) {
  const { location } = await params;
  if (isConfigured() && !isLocationId(location)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // The only legitimate caller is the board page itself, fetching its own
  // path. Browsers set Sec-Fetch-Site on every fetch and it cannot be forged
  // from script, so same-origin is a real check rather than a header a caller
  // chooses. Anything that omits it is not a browser doing what we asked.
  const site = request.headers.get('sec-fetch-site');
  if (site !== 'same-origin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json(await loadBoardTickets(location), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    // The client keeps its last good board on a non-200, which is the right
    // outcome here: a failed reconcile must not blank a wall.
    console.error('display: reconcile read failed', error);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
