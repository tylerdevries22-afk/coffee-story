/**
 * POST /api/places/details -- the one billed lookup for the business a
 * platform admin picked, answered as the wizard's draft.
 *
 * Body: `{ placeId, sessionToken }`, the token being the one its suggestions
 * were fetched under: that is what leaves those keystrokes unbilled. See
 * lib/places-proxy-context.ts for who may call this and how often.
 */
import { currentSession } from '../../../../lib/auth';
import { placesDetails } from '../../../../lib/places-proxy';
import { placesKey, placesRequestContext } from '../../../../lib/places-proxy-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const context = await placesRequestContext(request, 'details', {
    session: currentSession, apiKey: () => placesKey(),
  });
  if (context instanceof Response) return context;
  return placesDetails(request, context);
}
