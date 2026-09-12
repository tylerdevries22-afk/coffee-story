import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * training-media moved from a public bucket to a private one
 * (20260912090000_training_media_is_private.sql). The draft and published
 * manifests, and content_media_versions, keep the historical "public" URL
 * shape as their stable identity -- saveTrainingDraft round-trips it
 * unchanged and the capture triggers match on it -- so this only resolves a
 * short-lived signed URL for display; nothing here is persisted.
 *
 * apps/hq does not depend on @platform/data, so this mirrors
 * packages/data/src/signed-training-media.ts rather than adding a
 * cross-package dependency for one helper (see CLAUDE.md's note on the
 * transitional duplication between the apps and packages/*).
 */
const TRAINING_MEDIA_PATH_MARKER = '/storage/v1/object/public/training-media/';
const DEFAULT_TTL_SECONDS = 300;
const SIGN_TIMEOUT_MS = 8_000;
const SIGN_ATTEMPTS = 2;

/** The object path inside `training-media`, or null when `url` is not one of ours. */
export function trainingMediaObjectPath(url: string | undefined | null): string | null {
  if (!url) return null;
  const index = url.indexOf(TRAINING_MEDIA_PATH_MARKER);
  return index < 0 ? null : url.slice(index + TRAINING_MEDIA_PATH_MARKER.length);
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('training media signing timed out')), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Exchanges one training-media URL for a signed one through the caller's own
 * RLS-bound client, so Storage evaluates storage_training_media_read against
 * the caller's own JWT: a brand-staff caller can only ever sign what that
 * policy already lets them read. Anything that is not a training-media
 * object (an external link, a blob: preview, a demo placeholder) passes
 * through untouched. One retry and a timeout guard the external Storage call.
 */
export async function signTrainingMediaUrl(
  client: SupabaseClient,
  url: string | undefined | null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  timeoutMs = SIGN_TIMEOUT_MS,
): Promise<string | null> {
  const path = trainingMediaObjectPath(url);
  if (!path) return url ?? null;
  for (let attempt = 0; attempt < SIGN_ATTEMPTS; attempt += 1) {
    try {
      const result = await withTimeout(
        client.storage.from('training-media').createSignedUrl(path, ttlSeconds),
        timeoutMs,
      );
      if (!result.error && result.data?.signedUrl) return result.data.signedUrl;
    } catch {
      // Retried below; the final attempt's failure falls through to null so
      // the thumbnail renders its usual "unavailable" state.
    }
  }
  return null;
}
