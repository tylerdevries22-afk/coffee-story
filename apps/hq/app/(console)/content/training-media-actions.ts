'use server';

import { currentSession, hasRole } from '@/lib/auth';
import { serverClient } from '@/lib/supabase-server';
import { signTrainingMediaUrl } from '@/lib/training-media-urls';

/**
 * Resolves one training-media URL to a short-lived signed one for display.
 *
 * The draft/published manifest and content_media_versions keep the
 * historical "public" URL string as their stable identity -- saveTrainingDraft
 * sends that same string back on every save, and the capture triggers match
 * on it -- so this is purely a render-time exchange. Nothing calling this
 * ever writes the result back into a draft.
 *
 * Gated at the same "may view training" threshold as the training page
 * itself (see apps/hq/app/(console)/training/page.tsx); Storage then applies
 * the real per-brand check when it evaluates storage_training_media_read
 * against this caller's own JWT, so a manager can only ever resolve a URL
 * their own brand's policy already lets them read.
 */
export async function resolveTrainingMediaSrc(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const session = await currentSession();
  if (!session || !hasRole(session, 'location_manager')) return null;
  const client = await serverClient();
  if (!client) return null;
  return signTrainingMediaUrl(client, url);
}
