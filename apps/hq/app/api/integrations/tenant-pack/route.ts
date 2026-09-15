/** Receive one validated tenant-pack snapshot from Elevate. */
import { CORS_HEADERS, corsPreflight, jsonError } from '../../../../lib/api-auth';
import {
  integrationContext, integrationRequestId,
} from '../../../../lib/integration-summary';
import { validateIntegrationTenantPack } from '../../../../lib/integration-tenant-pack';
import { log } from '../../../../lib/log';

export const runtime = 'nodejs';
const MAX_REQUEST_BYTES = 8 * 1024 * 1024 + 64 * 1024;

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    return jsonError(413, 'request_too_large', 'The tenant pack exceeds the request limit.');
  }
  const context = await integrationContext(request);
  if (context instanceof Response) return context;
  const requestId = integrationRequestId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_request', 'Send one JSON tenant-pack snapshot.');
  }
  const validated = validateIntegrationTenantPack(body);
  if (validated.kind === 'invalid') {
    return Response.json(
      { code: 'invalid_tenant_pack', error: 'The tenant pack did not validate.', issues: validated.issues },
      { status: 422, headers: CORS_HEADERS },
    );
  }
  if (validated.snapshot.brandId !== context.brandId) {
    return jsonError(400, 'invalid_request', 'brandId must match the requested brand.');
  }

  const result = await context.db.rpc('receive_integration_tenant_pack', {
    p_brand_id: context.brandId,
    p_slug: validated.snapshot.slug,
    p_revision: validated.snapshot.revision,
    p_files: validated.snapshot.files,
    p_source_repo: validated.snapshot.sourceRepo,
    p_source_commit: validated.snapshot.sourceCommit,
  });
  if (result.error) {
    if (result.error.message.includes('tenant_pack_denied')) {
      log.warn('integration.tenant_pack.denied', {
        requestId, actorId: context.userId, brandId: context.brandId,
      });
      return jsonError(403, 'forbidden', 'That brand is not available to this integration.');
    }
    if (result.error.message.includes('tenant_pack_stale_revision')) {
      return jsonError(409, 'stale_revision', 'A newer tenant-pack revision is already stored.');
    }
    if (result.error.message.includes('tenant_pack_revision_conflict')) {
      return jsonError(409, 'revision_conflict', 'That revision already has different contents.');
    }
    log.error('integration.tenant_pack.failed', {
      requestId, actorId: context.userId, brandId: context.brandId,
    }, result.error);
    return jsonError(503, 'tenant_pack_unavailable', 'The tenant pack could not be stored right now.');
  }

  log.info('integration.tenant_pack.received', {
    requestId, actorId: context.userId, brandId: context.brandId,
    slug: validated.snapshot.slug, revision: validated.snapshot.revision,
  });
  return Response.json(
    { stored: true, slug: validated.snapshot.slug, revision: validated.snapshot.revision },
    { status: 201, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
  );
}
