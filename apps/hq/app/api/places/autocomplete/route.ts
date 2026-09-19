/**
 * POST /api/places/autocomplete -- suggestions while a platform admin types a
 * business name into the new-organization wizard.
 *
 * Body: `{ input, sessionToken, regionCode? }`. The key stays on this server;
 * see lib/places-proxy-context.ts for who may call this and how often.
 * Imports are relative so the route loads in process under test.
 */
import { currentSession } from '../../../../lib/auth';
import { placesAutocomplete } from '../../../../lib/places-proxy';
import { placesKey, placesRequestContext } from '../../../../lib/places-proxy-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const context = await placesRequestContext(request, 'autocomplete', {
    session: currentSession, apiKey: () => placesKey(),
  });
  if (context instanceof Response) return context;
  return placesAutocomplete(request, context);
}
