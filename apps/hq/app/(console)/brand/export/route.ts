import { currentSession, hasRole } from '@/lib/auth';
import { serverClient } from '@/lib/supabase-server';
import { selectedOrganizationId } from '@/lib/workspace-scope';

/**
 * GET /brand/export — brand-owner org portability package (JSON download).
 */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) {
    return new Response('Brand owner access required.', { status: 403 });
  }
  const brandId = await selectedOrganizationId(session);
  if (!brandId) {
    return new Response('No organization selected.', { status: 400 });
  }
  const client = await serverClient();
  if (!client) {
    return new Response('Database is not configured.', { status: 503 });
  }
  const result = await client.rpc('export_brand_organization_data', { p_brand_id: brandId });
  if (result.error || result.data == null) {
    return new Response('Export is temporarily unavailable.', { status: 503 });
  }
  const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
  const slug = typeof result.data === 'object' && result.data && 'brand' in (result.data as object)
    ? String(((result.data as { brand?: { slug?: string } }).brand?.slug) || 'organization')
    : 'organization';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-organization-export.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
