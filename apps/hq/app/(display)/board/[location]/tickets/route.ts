import { NextResponse } from 'next/server';

import { loadBoardTickets } from '@/lib/data';

/**
 * The board's reconcile read.
 *
 * A wall-mounted tablet has nobody watching for a dropped socket, so the
 * display re-reads on a timer rather than trusting Realtime alone. Same loader
 * as the page, so the two can never disagree about what the board is.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ location: string }> },
) {
  const { location } = await params;
  return NextResponse.json(await loadBoardTickets(location), {
    headers: { 'cache-control': 'no-store' },
  });
}
