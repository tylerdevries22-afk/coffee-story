import {
  requestWithRetry, safeEndpoint, serviceHeaders, TenantPackageError,
} from '@platform/factory';

type Candidate = { object_path: string; release_id: string | null; reason: string };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TenantPackageError('configuration_missing', `${name} is required.`);
  return value;
}

async function rpc(endpoint: URL, headers: Record<string, string>, name: string, body: unknown) {
  return requestWithRetry(new URL(`/rest/v1/rpc/${name}`, endpoint), {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const endpoint = safeEndpoint(required('SUPABASE_URL'));
  const headers = serviceHeaders(required('SUPABASE_SERVICE_ROLE_KEY'));
  const response = await rpc(endpoint, headers, 'list_tenant_package_cleanup_candidates', { p_limit: 500 });
  const candidates = await response.json() as Candidate[];
  if (!Array.isArray(candidates)) throw new TenantPackageError('cleanup_invalid', 'Cleanup response is invalid.');
  const paths = candidates.map((candidate) => candidate.object_path);
  if (paths.length > 0) {
    await requestWithRetry(new URL('/storage/v1/object/tenant-packages', endpoint), {
      method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    }, [200, 404]);
  }
  const releaseIds = [...new Set(candidates
    .map((candidate) => candidate.release_id)
    .filter((releaseId): releaseId is string => Boolean(releaseId)))];
  await rpc(endpoint, headers, 'confirm_tenant_package_object_purge', { p_release_ids: releaseIds });
  process.stdout.write(`${JSON.stringify({ removedObjects: paths.length })}\n`);
}

main().catch((error: unknown) => {
  const code = error instanceof TenantPackageError ? error.code : 'tenant_package_cleanup_failed';
  process.stderr.write(`${JSON.stringify({ code, message: 'Tenant package cleanup failed.' })}\n`);
  process.exitCode = 1;
});
