import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrainingManifest } from '@platform/domain';

/**
 * training-media moved from a public bucket to a private one
 * (20260912090000_training_media_is_private.sql). A published manifest still
 * carries the historical "public" URL shape as its stable identity -- it is
 * what content_media_versions and re-publication matching key on -- so a
 * reader exchanges it for a short-lived signed URL rather than the writer
 * changing what it stores.
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
 * Exchanges one training-media URL for a signed one via the caller's own
 * client, so Storage evaluates storage_training_media_read against the
 * caller's own JWT: a brand-staff caller can only ever sign what that policy
 * already lets them read. Anything that is not a training-media object (an
 * external link, a demo placeholder) passes through untouched. One retry and
 * a timeout guard the external Storage call.
 */
export async function signTrainingMediaUrl(
  client: SupabaseClient,
  url: string | undefined,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  timeoutMs = SIGN_TIMEOUT_MS,
): Promise<string | undefined> {
  const path = trainingMediaObjectPath(url);
  if (!path) return url;
  for (let attempt = 0; attempt < SIGN_ATTEMPTS; attempt += 1) {
    try {
      const result = await withTimeout(
        client.storage.from('training-media').createSignedUrl(path, ttlSeconds),
        timeoutMs,
      );
      if (!result.error && result.data?.signedUrl) return result.data.signedUrl;
    } catch {
      // Retried below; the final attempt's failure falls through to undefined
      // so the caller renders its usual "no media" state instead of a dead link.
    }
  }
  return undefined;
}

/** Signs every icon and lesson-media URL a training manifest carries. */
export async function signTrainingManifestMedia(
  client: SupabaseClient,
  manifest: TrainingManifest,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<TrainingManifest> {
  const tracks = await Promise.all(manifest.tracks.map(async (track) => {
    const iconUrl = await signTrainingMediaUrl(client, track.icon.url, ttlSeconds);
    const lessons = await Promise.all(track.lessons.map(async (lesson) => ({
      ...lesson,
      media: await Promise.all(lesson.media.map(async (item) => ({
        ...item,
        url: (await signTrainingMediaUrl(client, item.url, ttlSeconds)) ?? item.url,
      }))),
    })));
    return { ...track, icon: { ...track.icon, url: iconUrl }, lessons };
  }));
  return { ...manifest, tracks };
}
