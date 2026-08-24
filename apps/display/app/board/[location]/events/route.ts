import { createClient } from '@supabase/supabase-js';

import { subscribeToBoardChanges } from '@platform/data';

import { isConfigured, isLocationId } from '@/lib/board';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const encoder = new TextEncoder();

/** Server-sent invalidations keep the paired device token out of the browser. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ location: string }> },
) {
  const { location } = await params;
  if (!isConfigured() || !isLocationId(location)) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const token = process.env.DISPLAY_DEVICE_TOKEN;
  if (!url || !token) return Response.json({ error: 'unavailable' }, { status: 503 });

  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      };
      const database = createClient(url, token, { auth: { persistSession: false } });
      const unsubscribe = subscribeToBoardChanges(database, location, () => send('change'));
      const heartbeat = setInterval(() => send('heartbeat'), 25_000);
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };
      request.signal.addEventListener('abort', close, { once: true });
      send('connected');
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
      'x-accel-buffering': 'no',
    },
  });
}
