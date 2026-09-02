'use client';

import { useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

import type { AppPreview, AppPreviewKey } from '@/lib/app-previews';
import { layoutExtent } from '@/lib/app-wall-fit';

import { AppsPreviewStack } from './apps-preview-stack';
import { AppsPreviewTile } from './apps-preview-tile';
import { useWallGestures, type WallNotice } from './use-wall-gestures';
import { useWallLayout } from './use-wall-layout';
import { useWallCore } from './use-wall-simulation';
import { useWallMode, useWallViewport } from './use-wall-viewport';

const ROTATABLE_APPS = new Set<AppPreviewKey>(['kiosk', 'operator', 'display']);

const NOTICE: Readonly<Record<WallNotice, (label: string) => string>> = {
  moving: (label) => `Moving ${label}. Devices yield as you pass them.`,
  resizing: (label) => `Resizing ${label}. The surrounding layout is responding.`,
  placed: (label) => `${label} placed. Nearby devices settled into place.`,
  resized: (label) => `${label} resized. The wall filled in around it.`,
  refused: (label) => `There is not enough room for ${label} there.`,
  moved: (label) => `${label} moved.`,
  enlarged: (label) => `${label} enlarged.`,
  reduced: (label) => `${label} reduced.`,
  rotated: (label) => `${label} orientation changed.`,
  'rotate-refused': (label) => `There is not enough room to rotate ${label}.`,
};

/** A full-width app wall with direct manipulation, live collision response, and spring settling. */
export function AppsPreviewMosaic({ previews }: { readonly previews: readonly AppPreview[] }) {
  const mode = useWallMode();
  const keys = useMemo(() => previews.map((preview) => preview.key), [previews]);
  const layout = useWallLayout(keys);
  const reducedMotion = useReducedMotion() ?? false;
  if (mode === 'stack') return <AppsPreviewStack master={layout.master} onCommit={layout.commit} previews={previews} reducedMotion={reducedMotion} rotatable={ROTATABLE_APPS} />;
  return <WallCanvas layout={layout} previews={previews} reducedMotion={reducedMotion} />;
}

type CanvasProps = { readonly layout: ReturnType<typeof useWallLayout>; readonly previews: readonly AppPreview[]; readonly reducedMotion: boolean };

function WallCanvas({ layout, previews, reducedMotion }: CanvasProps) {
  const canvasRef = useRef<HTMLOListElement>(null);
  // The wall measures its wrapper, never the list: the list is absolute in
  // wall mode and grows in stacked mode, so measuring it would feed a stacked
  // layout's height back into the fit that chose stacking.
  const viewportRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const spotlightRef = useRef<HTMLLIElement>(null);
  const [notice, setNotice] = useState('Live previews are ready.');
  const viewport = useWallViewport(viewportRef);
  const byKey = useMemo(() => new Map(previews.map((preview) => [preview.key, preview])), [previews]);
  const core = useWallCore({ master: layout.master, bounds: viewport.bounds, ready: viewport.ready, cell: viewport.width / 60, reduced: reducedMotion, onCommit: layout.commit });
  const gestures = useWallGestures(core, (kind, key) => setNotice(NOTICE[kind](byKey.get(key)?.label ?? 'App')));
  const stackedRows = core.mode === 'stacked' ? layoutExtent(core.tiles).rows : null;
  const previousRows = useRef(core.canvasRows);

  useEffect(() => {
    const grew = core.canvasRows > previousRows.current + 1;
    previousRows.current = core.canvasRows;
    if (!grew || (core.phase?.phase !== 'dragging' && core.phase?.phase !== 'resizing')) return;
    const wall = viewportRef.current;
    if (wall) wall.scrollTo({ top: wall.scrollHeight, behavior: 'auto' });
    setNotice('A new wall row opened for this device.');
  }, [core.canvasRows, core.phase?.phase]);

  const spotlight = (event: PointerEvent<HTMLOListElement>) => {
    const canvas = canvasRef.current; const glow = glowRef.current; const overlay = spotlightRef.current;
    if (!canvas || !glow || !overlay) return;
    const rect = canvas.getBoundingClientRect();
    const radius = glow.getBoundingClientRect().width / 2;
    overlay.style.opacity = '1';
    glow.style.transform = `translate3d(${event.clientX - rect.left - radius}px, ${event.clientY - rect.top - radius}px, 0)`;
  };

  return (
    <section aria-label="Production app simulator" className="apps-preview-canvas-shell">
      <p aria-live="polite" className="sr-only" id="apps-preview-instructions">{notice}</p>
      <div className="apps-wall-viewport" data-mode={core.mode} ref={viewportRef}>
        <ol className="apps-preview-grid" data-mode={core.mode} data-ready={viewport.ready || undefined} onPointerLeave={() => { if (spotlightRef.current) spotlightRef.current.style.opacity = '0'; }} onPointerMove={spotlight} ref={canvasRef} style={{ aspectRatio: `60 / ${stackedRows ?? core.canvasRows}` }}>
          <li aria-hidden="true" className="apps-preview-grid-spotlight" ref={spotlightRef}><span className="apps-preview-grid-glow" ref={glowRef} /></li>
          {core.tiles.map((tile) => {
            const preview = byKey.get(tile.key);
            if (!preview) return null;
            return <AppsPreviewTile key={tile.key} motion={core.motionFor(tile.key)} onDragEnd={gestures.dragEnd} onDragMove={gestures.dragMove} onDragStart={() => gestures.dragStart(tile.key)} onKeyMove={(dx, dy) => gestures.nudge(tile.key, dx, dy)} onResizeBy={(amount) => gestures.resizeBy(tile.key, amount)} onResizeEnd={gestures.resizeEnd} onResizeMove={gestures.resizeMove} onResizeStart={(corner) => gestures.resizeStart(tile.key, corner)} onRotate={() => gestures.rotate(tile.key)} phase={core.phase?.key === tile.key ? core.phase.phase : 'idle'} preview={preview} ready={viewport.ready} reducedMotion={reducedMotion} rotatable={ROTATABLE_APPS.has(tile.key)} tile={tile} />;
          })}
        </ol>
      </div>
    </section>
  );
}
