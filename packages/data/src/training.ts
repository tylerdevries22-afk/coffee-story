import type { SupabaseClient } from '@supabase/supabase-js';

import { liftTrainingManifest, type TrainingManifest } from '@platform/domain';

import { readWithRetry } from './read-retry';

export type PublishedTrainingRelease = { id: string; manifest: TrainingManifest };

function parseManifest(value: unknown): TrainingManifest {
  const manifest = liftTrainingManifest(value);
  if (!manifest) throw new Error('The published training release is invalid.');
  return manifest;
}

/** Loads the one published release visible to a tenant's staff JWT. */
export async function fetchPublishedTrainingRelease(
  client: SupabaseClient,
  brandId: string,
): Promise<PublishedTrainingRelease | null> {
  const row = await readWithRetry('fetchPublishedTrainingRelease', (signal) => client
    .from('training_releases')
    .select('id, manifest')
    .eq('brand_id', brandId)
    .eq('status', 'published')
    .abortSignal(signal)
    .maybeSingle<{ id: string; manifest: unknown }>());
  if (!row) return null;
  return { id: row.id, manifest: parseManifest(row.manifest) };
}

/**
 * Reports a release boundary rather than patching manifest JSON in memory.
 * Consumers refetch the complete immutable release after a coalesced event.
 */
export function subscribeToTrainingReleases(
  client: SupabaseClient | null,
  brandId: string,
  onChanged: () => void,
  settleMs = 350,
): () => void {
  if (!client) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = true;
  const settle = () => {
    if (!live) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (live) onChanged();
    }, settleMs);
  };
  const channel = client
    .channel(`training-releases-${brandId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'training_release_events', filter: `brand_id=eq.${brandId}`,
    }, settle)
    // SUBSCRIBED is emitted on the initial connection and after a Realtime
    // reconnect. Refetching at that boundary closes the gap where a release
    // was published while this device was offline.
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') settle();
    });
  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
