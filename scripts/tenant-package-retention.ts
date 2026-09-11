import {
  discardResponse, isCanonicalPostgresUuid, parseTenantPackageObjectPath,
  readBoundedJson, requestWithRetry, safeEndpoint, serviceHeaders, TenantPackageError,
} from '@platform/factory';
import { pathToFileURL } from 'node:url';

import { runWithClaimHeartbeat } from './tenant-package-retention-lease';

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
  renew(claimId: string): Promise<unknown>;
  remove(paths: readonly string[], signal?: AbortSignal): Promise<void>;
};

const MAX_CLAIM_ROWS = 500;
const MAX_PATH_BYTES = 1_500;
const MAX_ESCAPED_PATH_BYTES = MAX_PATH_BYTES * 2;
const MAX_ROW_JSON_OVERHEAD_BYTES = 512;
const MIB = 1024 * 1024;
export const TENANT_PACKAGE_CLAIM_RESPONSE_BYTES = Math.ceil(
  MAX_CLAIM_ROWS * (MAX_ESCAPED_PATH_BYTES + MAX_ROW_JSON_OVERHEAD_BYTES) / MIB,
) * MIB;
const SCALAR_RESPONSE_BYTES = 4 * 1024;
const DEFAULT_HEARTBEAT_MS = 2 * 60_000;

function candidates(value: unknown, requestedLimit: number): Candidate[] {
  if (!Array.isArray(value)) invalidResponse();
  const rows = value as unknown[];
  if (rows.length > requestedLimit) invalidResponse();
  const namespaces = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') invalidResponse();
    const item = row as Partial<Candidate>;
    if (!isCanonicalPostgresUuid(item.target_id ?? '')
      || !isCanonicalPostgresUuid(item.claim_id ?? '')
      || !['cleanup_blocked', 'retention_expired', 'stale_verified', 'upload_expired']
        .includes(item.reason ?? '')
      || (item.object_path !== null && (typeof item.object_path !== 'string'
        || !parseTenantPackageObjectPath(item.object_path)))) {
      invalidResponse();
    }
    if (typeof item.object_path === 'string') {
      const namespace = parseTenantPackageObjectPath(item.object_path)?.namespace;
      if (!namespace) invalidResponse();
      namespaces.add(namespace);
    }
  }
  const typed = rows as Candidate[];
  const nullPaths = typed.filter((item) => item.object_path === null).length;
  if (new Set(typed.map((item) => item.claim_id)).size > 1
    || new Set(typed.map((item) => item.target_id)).size > 1
    || new Set(typed.map((item) => item.reason)).size > 1
    || namespaces.size > 1 || (nullPaths > 0 && typed.length !== 1)) invalidResponse();
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
  options: { batchSize?: number; heartbeatMs?: number; maxBatches?: number } = {},
): Promise<RetentionResult> {
  const batchSize = options.batchSize ?? MAX_CLAIM_ROWS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const maxBatches = options.maxBatches ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_CLAIM_ROWS
    || !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 5 * 60_000
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
    const claimed = candidates(await operations.claim(batchSize), batchSize);
    if (claimed.length === 0) break;
    const paths = claimed.flatMap((candidate) => candidate.object_path ? [candidate.object_path] : []);
    const blocked = claimed[0]?.reason === 'cleanup_blocked';
    if (blocked && paths.length > 0) invalidResponse();
    if (new Set(paths).size !== paths.length) invalidResponse();
    if (paths.length > 0) {
      const claimId = claimed[0]?.claim_id;
      if (!claimId) invalidResponse();
      await runWithClaimHeartbeat({
        renew: () => operations.renew(claimId),
        remove: (signal) => operations.remove(paths, signal),
        heartbeatMs,
      });
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
      return readBoundedJson(response, TENANT_PACKAGE_CLAIM_RESPONSE_BYTES);
    },
    async confirm(claimId) {
      const response = await rpc(endpoint, headers, 'confirm_tenant_package_purge_claim', {
        p_claim_id: claimId,
      });
      return readBoundedJson(response, SCALAR_RESPONSE_BYTES);
    },
    async renew(claimId) {
      const response = await rpc(endpoint, headers, 'renew_tenant_package_purge_claim', {
        p_claim_id: claimId,
      });
      return readBoundedJson(response, SCALAR_RESPONSE_BYTES);
    },
    async remove(paths, signal) {
      const response = await requestWithRetry(new URL('/storage/v1/object/tenant-packages', endpoint), {
        method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }), signal,
      }, [200, 404]);
      await discardResponse(response);
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
