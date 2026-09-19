/** POST /api/integrations/actz/organizations — ACTZ partner create (no platform_admin cookie). */
import { idempotencyKeyOf, jsonError, jsonWithCors, corsPreflight } from '../../../../../lib/api-auth';
import { authenticateActzPartner } from '../../../../../lib/actz-partner-auth';
import { rateLimited, clientIdentity } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

type CreateBody = {
  actzProviderOrgId?: unknown;
  name?: unknown;
  slug?: unknown;
  industryKey?: unknown;
  locationName?: unknown;
  locationTimezone?: unknown;
};

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function POST(request: Request): Promise<Response> {
  const auth = authenticateActzPartner(request);
  if (!auth.ok) return auth.response;
  if (rateLimited(clientIdentity(request), 'integrations/actz/organizations', Date.now(), 30)) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again shortly.');
  }
  const idempotency = idempotencyKeyOf(request);
  if (idempotency === false) {
    return jsonError(400, 'invalid_request', 'Idempotency-Key must be a UUID.');
  }
  if (!idempotency) {
    return jsonError(400, 'invalid_request', 'Send an Idempotency-Key UUID header.');
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_request', 'Send a JSON body.');
  }

  const actzProviderOrgId =
    typeof body.actzProviderOrgId === 'string' ? body.actzProviderOrgId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const industryKey =
    typeof body.industryKey === 'string' && body.industryKey.trim()
      ? body.industryKey.trim()
      : 'hospitality';
  const locationName =
    typeof body.locationName === 'string' && body.locationName.trim()
      ? body.locationName.trim()
      : null;
  const locationTimezone =
    typeof body.locationTimezone === 'string' && body.locationTimezone.trim()
      ? body.locationTimezone.trim()
      : 'America/Denver';

  if (!actzProviderOrgId || actzProviderOrgId.length < 8) {
    return jsonError(400, 'invalid_request', 'actzProviderOrgId is required.');
  }
  if (name.length < 2) return jsonError(400, 'invalid_request', 'name is required.');
  if (!SLUG.test(slug)) return jsonError(400, 'invalid_request', 'slug must be kebab-case.');

  if (auth.handoff && auth.handoff.actzProviderOrgId !== actzProviderOrgId) {
    return jsonError(403, 'forbidden', 'Handoff token does not match actzProviderOrgId.');
  }

  const result = await auth.db.rpc('provision_actz_partner_organization', {
    p_idempotency_key: idempotency,
    p_actz_provider_org_id: actzProviderOrgId,
    p_name: name,
    p_slug: slug,
    p_industry_key: industryKey,
    p_location_name: locationName,
    p_location_timezone: locationTimezone,
  });

  if (result.error) {
    const message = result.error.message ?? '';
    if (message.includes('slug_or_mapping_conflict')) {
      return jsonError(409, 'conflict', 'That slug or ACTZ mapping is already in use.');
    }
    if (message.includes('actz_partner_service_role_required')) {
      return jsonError(503, 'misconfigured', 'Partner provision is not available on this deployment.');
    }
    return jsonError(503, 'provision_unavailable', 'The organization could not be provisioned right now.');
  }

  const payload = result.data as Record<string, unknown> | null;
  const replayed = payload?.replayed === true;
  return jsonWithCors(payload, replayed ? 200 : 201);
}
