import {
  requestWithRetry, safeEndpoint, serviceHeaders, TenantPackageError,
} from '@platform/factory';
import { pathToFileURL } from 'node:url';

type Candidate = {
  object_path: string | null;
  target_id: string;
  claim_id: string;
  reason: 'cleanup_blocked' | 'retention_expired' | 'stale_verified' | 'upload_expired';
};

export type RetentionResult = {
  batches: number;
  blockedClaims: number;
  capped: boolean;
  confirmedClaims: number;
  removedObjects: number;
  requeuedClaims: number;
};

export type RetentionOperations = {
  claim(limit: number): Promise<unknown>;
  confirm(claimId: string): Promise<unknown>;
  remove(paths: readonly string[]): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

function validObjectPath(path: string): boolean {
  const [brandId, artifactDigest, third, fourth, ...rest] = path.split('/');
  if (!brandId || !UUID.test(brandId) || !artifactDigest || !DIGEST.test(artifactDigest)
    || !third || Buffer.byteLength(path) > 1_500 || path.includes('\\')
    || CONTROL.test(path)) return false;
  const modern = DIGEST.test(third);
  const kind = modern ? fourth : third;
  const tail = modern ? rest : [fourth, ...rest].filter((part): part is string => part !== undefined);
  if (kind === 'archive.zip') return tail.length === 0;
  return (kind === 'files' || kind === 'previews')
    && tail.length > 0 && tail.every((part) => Boolean(part) && part !== '.' && part !== '..');
}

function candidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) invalidResponse();
  const rows = value as unknown[];
  for (const row of rows) {
    if (!row || typeof row !== 'object') invalidResponse();
    const item = row as Partial<Candidate>;
    if (!UUID.test(item.target_id ?? '') || !UUID.test(item.claim_id ?? '')
      || !['cleanup_blocked', 'retention_expired', 'stale_verified', 'upload_expired']
        .includes(item.reason ?? '')
      || (item.object_path !== null && (typeof item.object_path !== 'string'
        || !validObjectPath(item.object_path)))) {
      invalidResponse();
    }
  }
  const typed = rows as Candidate[];
  if (new Set(typed.map((item) => item.claim_id)).size > 1
    || new Set(typed.map((item) => item.target_id)).size > 1
    || new Set(typed.map((item) => item.reason)).size > 1) invalidResponse();
  return typed;
}

function invalidResponse(): never {
  throw new TenantPackageError('cleanup_invalid', 'Cleanup response is invalid.');
}

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

export async function runTenantPackageRetention(
  operations: RetentionOperations,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<RetentionResult> {
  const batchSize = options.batchSize ?? 500;
  const maxBatches = options.maxBatches ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500
    || !Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new TenantPackageError('cleanup_configuration_invalid', 'Cleanup bounds are invalid.');
  }
  let removedObjects = 0;
  let blockedClaims = 0;
  let confirmedClaims = 0;
  let requeuedClaims = 0;
  let batches = 0;
  let capped = false;
  for (; batches < maxBatches;) {
    const claimed = candidates(await operations.claim(batchSize));
    if (claimed.length === 0) break;
    const paths = claimed.flatMap((candidate) => candidate.object_path ? [candidate.object_path] : []);
    const blocked = claimed[0]?.reason === 'cleanup_blocked';
    if (blocked && paths.length > 0) invalidResponse();
    if (new Set(paths).size !== paths.length) invalidResponse();
    if (paths.length > 0) {
      await operations.remove(paths);
      removedObjects += paths.length;
    }
    const claimId = claimed[0]?.claim_id;
    if (!claimId) invalidResponse();
    const confirmed = await operations.confirm(claimId);
    if (typeof confirmed !== 'boolean') invalidResponse();
    if (blocked && confirmed) invalidResponse();
    if (blocked) blockedClaims += 1;
    else if (confirmed) confirmedClaims += 1;
    else requeuedClaims += 1;
    batches += 1;
    capped = batches === maxBatches;
  }
  return { batches, blockedClaims, capped, confirmedClaims, removedObjects, requeuedClaims };
}

export async function main(): Promise<void> {
  const endpoint = safeEndpoint(required('SUPABASE_URL'));
  const headers = serviceHeaders(required('SUPABASE_SERVICE_ROLE_KEY'));
  const result = await runTenantPackageRetention({
    async claim(limit) {
      const response = await rpc(endpoint, headers, 'claim_tenant_package_cleanup_candidates', {
        p_limit: limit,
      });
      return response.json();
    },
    async confirm(claimId) {
      const response = await rpc(endpoint, headers, 'confirm_tenant_package_purge_claim', {
        p_claim_id: claimId,
      });
      return response.json();
    },
    async remove(paths) {
      await requestWithRetry(new URL('/storage/v1/object/tenant-packages', endpoint), {
        method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      }, [200, 404]);
    },
  });
  process.stdout.write(serializeRetentionResult(result));
}

export function serializeRetentionResult(result: RetentionResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function serializeRetentionFailure(error: unknown): string {
  const code = error instanceof TenantPackageError ? error.code : 'tenant_package_cleanup_failed';
  return `${JSON.stringify({ code, message: 'Tenant package cleanup failed.' })}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(serializeRetentionFailure(error));
    process.exitCode = 1;
  });
}
