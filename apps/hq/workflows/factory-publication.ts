const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PublicationExpectation = {
  p_previous_release_id: string | null;
  p_previous_artifact_digest: string | null;
  p_previous_commit_sha: string | null;
  p_previous_published_at: string | null;
};

export type PublicationTarget = {
  releaseId: string;
  artifactDigest: string;
  commitSha: string;
  canaryReference: string;
  approvalReference: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function publicationExpectation(value: unknown): PublicationExpectation {
  if (value === null) {
    return {
      p_previous_release_id: null, p_previous_artifact_digest: null,
      p_previous_commit_sha: null, p_previous_published_at: null,
    };
  }
  const row = record(value);
  const release = row?.current_release_id;
  const digest = row?.artifact_digest;
  const commit = row?.deployment_commit_sha;
  const publishedAt = row?.published_at;
  if (typeof release !== 'string' || !UUID.test(release)
    || typeof digest !== 'string' || !DIGEST.test(digest)
    || typeof commit !== 'string' || !COMMIT.test(commit)
    || typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error('Tenant package publication state is invalid.');
  }
  return {
    p_previous_release_id: release, p_previous_artifact_digest: digest,
    p_previous_commit_sha: commit, p_previous_published_at: publishedAt,
  };
}

export function publicationApplied(
  eventRows: unknown,
  pointerRows: unknown,
  target: PublicationTarget,
): boolean {
  if (!Array.isArray(eventRows) || eventRows.length !== 1
    || !Array.isArray(pointerRows) || pointerRows.length !== 1) return false;
  const event = record(eventRows[0]);
  const pointer = record(pointerRows[0]);
  return event?.package_release_id === target.releaseId
    && event.artifact_digest === target.artifactDigest
    && event.deployment_commit_sha === target.commitSha
    && event.canary_reference === target.canaryReference
    && event.approval_reference === target.approvalReference
    && typeof event.promoted_at === 'string'
    && pointer?.current_release_id === target.releaseId
    && pointer.artifact_digest === target.artifactDigest
    && pointer.deployment_commit_sha === target.commitSha
    && pointer.published_at === event.promoted_at;
}
