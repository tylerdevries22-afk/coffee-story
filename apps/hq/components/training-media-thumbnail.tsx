'use client';

import { useEffect, useState } from 'react';

import { resolveTrainingMediaSrc } from '@/app/(console)/content/training-media-actions';
import { trainingMediaObjectPath } from '@/lib/training-media-urls';

import { ManagedThumbnail } from './managed-thumbnail';

/**
 * Training images live behind a private bucket
 * (20260912090000_training_media_is_private.sql): the `url` a draft, its
 * icon, or its media history carries is a stable identifier, not something
 * the browser can fetch directly. This resolves a short-lived signed URL
 * just for display and never reports it back to the caller, so the editor's
 * own `url` state still round-trips through saveTrainingDraft unchanged.
 *
 * A non-training URL (an external link, a demo placeholder, a local blob:
 * preview right after picking a file) is rendered as-is with no round trip.
 */
export function TrainingMediaThumbnail({
  url, alt, className,
}: { url?: string | null; alt: string; className?: string }) {
  const [resolved, setResolved] = useState<string | null | undefined>(url);
  useEffect(() => {
    if (!trainingMediaObjectPath(url)) { setResolved(url); return undefined; }
    let live = true;
    setResolved(null);
    const refresh = () => {
      void resolveTrainingMediaSrc(url)
        .then((signed) => { if (live) setResolved(signed); })
        .catch(() => { if (live) setResolved(null); });
    };
    refresh();
    const timer = setInterval(refresh, 4 * 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [url]);
  return <ManagedThumbnail url={resolved} alt={alt} className={className} />;
}
