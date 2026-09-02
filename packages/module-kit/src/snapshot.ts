/**
 * Builds and verifies the immutable capability snapshot apps cache.
 *
 * Two properties matter here. Determinism: the signature covers a canonical
 * serialization (sorted keys, fixed field order), so the same resolution
 * signed twice produces the same signature and drift detection is a string
 * compare. Fail-closed expiry: `verifyCapabilitySnapshot` distinguishes
 * "wrong key" from "stale authority" because the plan gives them different
 * consequences -- an expired snapshot still serves cached reads, but must
 * never authorize a sensitive write.
 */
import type { ResolvedCapabilitySnapshot, ResolvedModule } from './types';

/** Stable JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) as string;
}

/** The payload the signature binds: every field except the signature itself. */
function snapshotPayload(snapshot: Omit<ResolvedCapabilitySnapshot, 'signature'>): string {
  return canonicalJson(snapshot);
}

export type SnapshotSigner = (payload: string) => string;
export type SnapshotVerifier = (payload: string, signature: string) => boolean;

export function buildCapabilitySnapshot(input: {
  readonly tenant: string;
  readonly site: string | null;
  readonly modules: readonly ResolvedModule[];
  readonly configRevision: number;
  readonly issuedAt: Date;
  readonly ttlSeconds: number;
  readonly sign: SnapshotSigner;
}): ResolvedCapabilitySnapshot {
  const permissions = [...new Set(input.modules.flatMap((module) => module.permissions))].sort();
  const unsigned = {
    tenant: input.tenant,
    site: input.site,
    modules: input.modules,
    permissions,
    configRevision: input.configRevision,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: new Date(input.issuedAt.getTime() + input.ttlSeconds * 1000).toISOString(),
  };
  return { ...unsigned, signature: input.sign(snapshotPayload(unsigned)) };
}

export type SnapshotVerification =
  | { readonly kind: 'valid' }
  | { readonly kind: 'bad-signature' }
  | { readonly kind: 'expired'; readonly expiredAt: string };

export function verifyCapabilitySnapshot(
  snapshot: ResolvedCapabilitySnapshot,
  verify: SnapshotVerifier,
  now: Date,
): SnapshotVerification {
  const { signature, ...unsigned } = snapshot;
  if (!verify(snapshotPayload(unsigned), signature)) return { kind: 'bad-signature' };
  if (now.toISOString() > snapshot.expiresAt) {
    return { kind: 'expired', expiredAt: snapshot.expiresAt };
  }
  return { kind: 'valid' };
}

/** Whether the snapshot grants a permission -- valid or not, expiry is the caller's call. */
export function snapshotGrants(
  snapshot: ResolvedCapabilitySnapshot,
  permission: string,
): boolean {
  return snapshot.permissions.includes(permission);
}

/**
 * The fail-closed rule from the plan, as one decision: sensitive actions need
 * a currently valid snapshot; anything else may ride a cached one while it is
 * merely expired-but-authentic.
 */
export function snapshotAuthorizes(
  snapshot: ResolvedCapabilitySnapshot,
  verification: SnapshotVerification,
  permission: string,
): boolean {
  if (verification.kind === 'bad-signature') return false;
  if (verification.kind === 'expired') return false;
  return snapshotGrants(snapshot, permission);
}
