'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { AppPreviewKey } from '@/lib/app-previews';
import type { WallLayout } from '@/lib/app-wall-fit';
import { defaultWallLayout, parseWallLayout, serializeWallLayout, WALL_STORAGE_KEY } from '@/lib/app-wall-storage';

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedLayout: WallLayout | null = null;

function readRaw(): string | null {
  try { return window.localStorage.getItem(WALL_STORAGE_KEY); } catch { return null; }
}

/** Parses only when the stored string changes, so the snapshot keeps its identity between renders. */
function snapshot(keys: readonly AppPreviewKey[]): WallLayout | null {
  const raw = readRaw();
  if (raw !== cachedRaw) { cachedRaw = raw; cachedLayout = parseWallLayout(raw, keys); }
  return cachedLayout;
}

function notify() {
  for (const listener of listeners) listener();
}

/** Clears the personal wall arrangement from any control surface. */
export function resetWallLayoutPreference() {
  try { window.localStorage.removeItem(WALL_STORAGE_KEY); } catch { /* A wall without storage can still reset in memory. */ }
  cachedRaw = undefined;
  cachedLayout = null;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

export type WallLayoutStore = {
  readonly master: WallLayout;
  readonly commit: (layout: WallLayout) => void;
  readonly reset: () => void;
};

/**
 * The authored wall, persisted in this browser. The server snapshot is null so
 * the first client render paints the stored arrangement without a flicker
 * through the default; storage failures fall back to the default silently,
 * the same bargain the navigation preference makes.
 */
export function useWallLayout(keys: readonly AppPreviewKey[]): WallLayoutStore {
  const stored = useSyncExternalStore(subscribe, () => snapshot(keys), () => null);
  const fallback = useMemo(() => defaultWallLayout(keys), [keys]);
  const commit = useCallback((layout: WallLayout) => {
    try { window.localStorage.setItem(WALL_STORAGE_KEY, serializeWallLayout(layout)); } catch { /* A wall that cannot be saved still works for this visit. */ }
    notify();
  }, []);
  const reset = useCallback(resetWallLayoutPreference, []);
  return { master: stored ?? fallback, commit, reset };
}
