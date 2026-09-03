import { track, type AnalyticsEventContext } from './analytics';
import { createAnalyticsId, createSessionHash } from './identity';
import type { AnalyticsTransport } from './transport';

export type AnalyticsSurfaceObservation = Readonly<{
  context: Omit<AnalyticsEventContext, 'sessionHash'>;
  screenKey: string;
  sessionIdentity: string;
}>;

export type AnalyticsSurfaceObserver = Readonly<{
  observe: (observation: AnalyticsSurfaceObservation) => number;
}>;

/**
 * Deduplicates surface observations and rotates the pseudonymous session when
 * the authenticated user, paired device, consent state, or kiosk reset changes.
 */
export function createAnalyticsSurfaceObserver(
  transport: Pick<AnalyticsTransport, 'enqueue'>,
  dependencies: Readonly<{
    createId?: () => string;
    createSessionHash?: () => string;
    now?: () => Date;
  }> = {},
): AnalyticsSurfaceObserver {
  const createId = dependencies.createId ?? createAnalyticsId;
  const nextSessionHash = dependencies.createSessionHash ?? createSessionHash;
  const now = dependencies.now ?? (() => new Date());
  let sessionIdentity: string | null = null;
  let sessionHash = nextSessionHash();
  let lastScreen: string | null = null;

  return Object.freeze({
    observe: (observation) => {
      let emitted = 0;
      const occurredAt = now().toISOString();
      if (sessionIdentity !== observation.sessionIdentity) {
        sessionIdentity = observation.sessionIdentity;
        sessionHash = nextSessionHash();
        lastScreen = null;
        const event = track({ ...observation.context, sessionHash }, {
          clientEventId: createId(),
          occurredAt,
          eventName: 'session.started',
          properties: { entryPoint: observation.screenKey },
        });
        if (event) {
          transport.enqueue(event);
          emitted += 1;
        }
      }
      if (lastScreen !== observation.screenKey) {
        lastScreen = observation.screenKey;
        const event = track({ ...observation.context, sessionHash }, {
          clientEventId: createId(),
          occurredAt,
          eventName: 'screen.viewed',
          properties: { screenKey: observation.screenKey },
        });
        if (event) {
          transport.enqueue(event);
          emitted += 1;
        }
      }
      return emitted;
    },
  });
}
