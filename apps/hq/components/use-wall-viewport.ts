'use client';

import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type RefObject } from 'react';

import { boundsFor } from '@/lib/app-wall-fit';
import type { WallBounds } from '@/lib/app-wall-geometry';

export type WallViewport = { readonly width: number; readonly height: number; readonly bounds: WallBounds; readonly ready: boolean };
export type WallMode = 'wall' | 'stack';

/** Below this width the wall becomes a list; the same breakpoint the console shell folds at. */
const STACK_QUERY = '(max-width: 47.5rem)';

/** The canvas size in pixels and the square-cell bounds derived from it, measured before first paint. */
export function useWallViewport(ref: RefObject<HTMLElement | null>): WallViewport {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const target = ref.current;
    if (!target) return undefined;
    let frame: number | null = null;
    const apply = () => {
      const next = { width: target.clientWidth, height: target.clientHeight };
      setSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    apply();
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => { frame = null; apply(); });
    });
    observer.observe(target);
    return () => { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
  }, [ref]);
  return useMemo(() => ({ ...size, bounds: boundsFor(size.width, size.height), ready: size.width > 0 && size.height > 0 }), [size]);
}

function subscribe(listener: () => void) {
  const media = window.matchMedia(STACK_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

export function useWallMode(): WallMode {
  return useSyncExternalStore(subscribe, () => (window.matchMedia(STACK_QUERY).matches ? 'stack' : 'wall'), () => 'wall');
}
