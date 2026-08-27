import {
  TRAINING_TRACK_ORDER,
  trainingTrackArtworkSvg,
  type CoreTrainingTrackKey,
} from '@platform/domain';

import { demoMediaAvailable } from '@/lib/demo-sync-http';

export async function GET(
  request: Request,
  context: { params: Promise<{ track: string }> },
): Promise<Response> {
  if (!demoMediaAvailable(request)) return new Response('Not found', { status: 404 });
  const { track } = await context.params;
  if (!TRAINING_TRACK_ORDER.includes(track as CoreTrainingTrackKey)) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(trainingTrackArtworkSvg(track as CoreTrainingTrackKey), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; style-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
