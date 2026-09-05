const DEFAULT_PREVIEW_WALL = 'http://localhost:4170/wall';
const SAFE_LOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export type WallTarget = {
  url: string;
  source: 'preview' | 'display' | 'hq';
};

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isAllowedUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
}

function readUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return isAllowedUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export function isWallLocationId(value: string): boolean {
  return SAFE_LOCATION_ID.test(value);
}

/**
 * Resolves the wall destination without allowing a tenant-controlled value to
 * turn the HQ page into an open redirect. Production defaults to a same-origin
 * tenant preview; local development can opt into the five-surface wall.
 */
export function wallTargetFor(locationId: string): WallTarget {
  if (!isWallLocationId(locationId)) {
    throw new Error('Invalid location id');
  }

  const configuredWall = readUrl(process.env.NEXT_PUBLIC_WALL_URL);
  if (configuredWall) {
    return { url: configuredWall.toString(), source: 'preview' };
  }

  if (process.env.NODE_ENV !== 'production') {
    return { url: DEFAULT_PREVIEW_WALL, source: 'preview' };
  }

  // A hosted display is paired to one physical location. HQ's same-origin
  // preview uses the signed-in session instead, so switching locations never
  // reuses the wrong device token or silently shows another location's queue.
  const displayOrigin = readUrl(process.env.NEXT_PUBLIC_DISPLAY_URL);
  if (!displayOrigin) {
    return { url: `/wall/preview/${encodeURIComponent(locationId)}`, source: 'hq' };
  }

  return {
    url: new URL(`/board/${encodeURIComponent(locationId)}`, displayOrigin).toString(),
    source: 'display',
  };
}
