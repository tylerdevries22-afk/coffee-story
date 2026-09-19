/** GET /api/integrations/actz/organizations/[id]/status — read-only; never go-live. */
import { corsPreflight, jsonError, jsonWithCors } from '../../../../../../../lib/api-auth';
import { authenticateActzPartner } from '../../../../../../../lib/actz-partner-auth';
import { actzPartnerStatusFrom } from '../../../../../../../lib/actz-partner-status';
import { rateLimited, clientIdentity } from '../../../../../../../lib/rate-limit';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = authenticateActzPartner(request);
  if (!auth.ok) return auth.response;
  if (rateLimited(clientIdentity(request), 'integrations/actz/status', Date.now(), 60)) {
    return jsonError(429, 'rate_limited', 'Too many requests. Try again shortly.');
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return jsonError(400, 'invalid_request', 'Organization id must be a UUID.');
  }

  const brand = await auth.db
    .from('brands')
    .select('id, slug, name, status, actz_provider_org_id')
    .eq('id', id)
    .maybeSingle<{
      id: string;
      slug: string;
      name: string;
      status: string;
      actz_provider_org_id: string | null;
    }>();

  if (brand.error) {
    return jsonError(503, 'unavailable', 'Could not read organization status.');
  }
  if (!brand.data || !brand.data.actz_provider_org_id) {
    return jsonError(404, 'not_found', 'No ACTZ-linked organization with that id.');
  }
  if (auth.handoff && auth.handoff.actzProviderOrgId !== brand.data.actz_provider_org_id) {
    return jsonError(403, 'forbidden', 'Handoff token does not match this organization.');
  }

  const run = await auth.db
    .from('organization_provisioning_runs')
    .select('stage')
    .eq('brand_id', id)
    .maybeSingle<{ stage: string }>();

  const body = actzPartnerStatusFrom({
    brandId: brand.data.id,
    slug: brand.data.slug,
    name: brand.data.name,
    actzProviderOrgId: brand.data.actz_provider_org_id,
    brandStatus: brand.data.status,
    runStage: run.data?.stage ?? null,
  });

  return jsonWithCors(body);
}
