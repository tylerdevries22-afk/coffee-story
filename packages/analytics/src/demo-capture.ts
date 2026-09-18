/**
 * Anonymous screen-view capture for the demo runtime (EXPO_PUBLIC_DEMO_RUNTIME
 * -- see apps/hq/app/d/events/route.ts and each app's demo-runtime screen
 * capture component).
 *
 * The tenant pipeline in surface-observer.ts/transport.ts needs a real
 * brandId, a pseudonymous session and a consent record; a demo visitor has
 * none of those, and the demo site is identified server-side, from the same
 * httpOnly cookie /d/pack.json already reads -- never from anything this
 * module sends. So this stays a separate, minimal capture: one event name,
 * pinned to the shared vocabulary below, deduped on the client, fire-and-
 * forget on the wire, with no retry queue that could turn a slow network into
 * a burst of duplicate requests.
 */
import type { AnalyticsEventName } from './analytics-types';

/** A typecheck failure here means 'screen.viewed' left ANALYTICS_EVENT_NAMES
 *  without this module noticing. */
export const DEMO_SCREEN_EVENT: AnalyticsEventName = 'screen.viewed';

export type DemoScreenReporter = Readonly<{
  /** Reports a screen, skipping consecutive repeats of the same one. */
  report: (screen: string) => void;
}>;

/** Dedupes consecutive identical screens so a re-render never double-counts. */
export function createDemoScreenReporter(send: (screen: string) => void): DemoScreenReporter {
  let last: string | null = null;
  return Object.freeze({
    report: (screen: string) => {
      if (screen === last) return;
      last = screen;
      send(screen);
    },
  });
}

export type DemoScreenViewFetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Fire-and-forget: one attempt, no retry, no queue. A dropped event under-
 * counts a screen view; a retry storm could look like a hammering client to
 * the rate limiter /d/events shares with every other `/d/` route.
 */
export function sendDemoScreenView(
  screen: string,
  deps: Readonly<{ endpoint?: string; fetcher?: DemoScreenViewFetcher }> = {},
): void {
  const endpoint = deps.endpoint ?? '/d/events';
  const fetcher = deps.fetcher ?? fetch;
  try {
    void fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ event: DEMO_SCREEN_EVENT, screen }),
    }).catch(() => undefined);
  } catch {
    // A synchronous throw (no fetch in this runtime) must never break navigation.
  }
}
