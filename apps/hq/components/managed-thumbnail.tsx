'use client';

import { useEffect, useRef, useState } from 'react';

import { ContentIcon } from './content-workspace';

type MediaState = 'empty' | 'loading' | 'ready' | 'error';

export function ManagedThumbnail({
  url,
  alt,
  className = 'content-thumb',
  showStatus = false,
}: {
  url?: string | null;
  alt: string;
  className?: string;
  showStatus?: boolean;
}) {
  const [state, setState] = useState<MediaState>(url ? 'loading' : 'empty');
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setState(url ? 'loading' : 'empty');
    const image = imageRef.current;
    if (url && image?.complete) setState(image.naturalWidth > 0 ? 'ready' : 'error');
  }, [url]);

  const message = state === 'error' ? 'Image unavailable' : state === 'empty' ? 'No image selected' : null;
  return (
    <span className={`${className} managed-thumbnail is-${state}`} role="img" aria-label={message ? `${alt}. ${message}.` : alt} data-media-status={state}>
      {url ? (
        // Tenant media may use an approved external URL, so this cannot be restricted to Next's build-time remote-host allowlist.
        <img ref={imageRef} src={url} alt="" loading="lazy" decoding="async" onLoad={() => setState('ready')} onError={() => setState('error')} />
      ) : null}
      {state === 'empty' || state === 'error' ? <ContentIcon kind="image" /> : null}
      {showStatus && message ? <small>{message}</small> : null}
    </span>
  );
}
