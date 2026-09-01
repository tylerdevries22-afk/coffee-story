'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import type { AppPreview, AppPreviewKey } from '@/lib/app-previews';

import { aspectOf, CANVAS_COLUMNS, CANVAS_ROWS, INITIAL_LAYOUT, reflowTiles, type AppPreviewTile } from './apps-preview-layout';
import { AppsPreviewTile } from './apps-preview-tile';

type SyncState = 'checking' | 'live' | 'offline' | 'hosted';
type CanvasMetrics = { readonly height: number; readonly width: number };
type Offset = { readonly x: number; readonly y: number };
type CanvasBounds = CanvasMetrics & { readonly left: number; readonly top: number };
type Interaction = { readonly kind: 'move' | 'resize'; readonly origin: AppPreviewTile };
const ROTATABLE_APPS = new Set<AppPreviewKey>(['kiosk', 'operator', 'display']);

function layoutsMatch(first: readonly AppPreviewTile[], second: readonly AppPreviewTile[]) {
  return first.every((tile, index) => tile.x === second[index]?.x && tile.y === second[index]?.y && tile.width === second[index]?.width);
}

function initialTiles(previews: readonly AppPreview[]): AppPreviewTile[] {
  return previews.map(({ key }) => INITIAL_LAYOUT[key]);
}

function candidateAtOffset(interaction: Interaction, offset: Offset, canvas: CanvasMetrics, settle: boolean) {
  const { origin } = interaction;
  const horizontal = offset.x / (canvas.width / CANVAS_COLUMNS);
  const vertical = offset.y / (canvas.height / CANVAS_ROWS);
  if (interaction.kind === 'move') {
    return { ...origin, x: settle ? Math.round(origin.x + horizontal) : origin.x + horizontal, y: settle ? Math.round(origin.y + vertical) : origin.y + vertical };
  }
  const width = origin.width + Math.max(horizontal, vertical * aspectOf(origin.key));
  return { ...origin, width: settle ? Math.round(width) : width };
}

/** A full-width app wall with direct manipulation, continuous collision response, and spring settling. */
export function AppsPreviewMosaic({ previews }: { readonly previews: readonly AppPreview[] }) {
  const canvasRef = useRef<HTMLOListElement>(null);
  const gridOverlayRef = useRef<HTMLLIElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const interactionFrameRef = useRef<number | null>(null);
  const gridFrameRef = useRef<number | null>(null);
  const latestOffsetRef = useRef<Offset>({ x: 0, y: 0 });
  const gridPointRef = useRef<Offset>({ x: 0, y: 0 });
  const gridBoundsRef = useRef<CanvasBounds | null>(null);
  const glowRadiusRef = useRef(0);
  const interactionChangedRef = useRef(false);
  const [canvas, setCanvas] = useState<CanvasMetrics>({ height: 0, width: 0 });
  const [compact, setCompact] = useState(false);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [sync, setSync] = useState<SyncState>('checking');
  const [tiles, setTiles] = useState<AppPreviewTile[]>(() => initialTiles(previews));
  const [notice, setNotice] = useState('Live previews are ready.');
  const [portrait, setPortrait] = useState<ReadonlySet<AppPreviewKey>>(() => new Set());
  const byKey = useMemo(() => new Map(previews.map((preview) => [preview.key, preview])), [previews]);

  useEffect(() => {
    const target = canvasRef.current;
    if (!target) return undefined;
    const measure = () => {
      const bounds = target.getBoundingClientRect();
      gridBoundsRef.current = { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width };
      glowRadiusRef.current = (glowRef.current?.getBoundingClientRect().width ?? 0) / 2;
      setCanvas({ height: bounds.height, width: bounds.width });
    };
    const observer = new ResizeObserver(measure);
    const media = window.matchMedia('(max-width: 62rem)');
    const updateCompact = () => setCompact(media.matches);
    observer.observe(target); media.addEventListener('change', updateCompact); measure(); updateCompact();
    return () => { observer.disconnect(); media.removeEventListener('change', updateCompact); };
  }, []);

  useEffect(() => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) { setSync('hosted'); return undefined; }
    let cancelled = false;
    const check = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3_000);
        try {
          const response = await fetch('http://localhost:3300/api/demo-sync/orders', { cache: 'no-store', signal: controller.signal });
          if (response.ok && Array.isArray((await response.json() as { orders?: unknown }).orders)) { if (!cancelled) setSync('live'); return; }
        } catch { /* A bounded retry keeps the preview responsive when the broker is starting. */ }
        finally { window.clearTimeout(timeout); }
      }
      if (!cancelled) setSync('offline');
    };
    void check();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current);
    if (gridFrameRef.current !== null) window.cancelAnimationFrame(gridFrameRef.current);
  }, []);

  const update = useCallback((key: AppPreviewKey, candidate: AppPreviewTile) => setTiles((current) => {
    const next = reflowTiles(current, key, candidate);
    interactionChangedRef.current ||= !layoutsMatch(current, next);
    return next;
  }), []);

  const applyInteraction = useCallback((offset: Offset, settle: boolean) => {
    const active = interactionRef.current;
    if (!active || !canvas.width || !canvas.height) return;
    update(active.origin.key, candidateAtOffset(active, offset, canvas, settle));
  }, [canvas, update]);

  const startInteraction = (tile: AppPreviewTile, kind: Interaction['kind']) => {
    const next = { kind, origin: tile } as Interaction;
    interactionRef.current = next; latestOffsetRef.current = { x: 0, y: 0 }; interactionChangedRef.current = false;
    setInteraction(next);
    setNotice(kind === 'move' ? `Moving ${byKey.get(tile.key)?.label ?? 'app'}. Devices yield as you pass them.` : `Resizing ${byKey.get(tile.key)?.label ?? 'app'}. The surrounding layout is responding.`);
  };

  const moveInteraction = (offset: Offset) => {
    latestOffsetRef.current = offset;
    if (interactionFrameRef.current !== null) return;
    interactionFrameRef.current = window.requestAnimationFrame(() => { interactionFrameRef.current = null; applyInteraction(latestOffsetRef.current, false); });
  };

  const endInteraction = () => {
    const active = interactionRef.current;
    if (!active) return;
    if (interactionFrameRef.current !== null) { window.cancelAnimationFrame(interactionFrameRef.current); interactionFrameRef.current = null; }
    applyInteraction(latestOffsetRef.current, true);
    interactionRef.current = null; setInteraction(null);
    const label = byKey.get(active.origin.key)?.label ?? 'App';
    const verb = active.kind === 'move' ? 'placed' : 'resized';
    setNotice(interactionChangedRef.current ? `${label} ${verb}. Nearby devices settled into place.` : `There is not enough room to ${active.kind === 'move' ? 'place' : 'resize'} that app there.`);
    interactionChangedRef.current = false;
  };

  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>, tile: AppPreviewTile) => {
    const delta: readonly [number, number] | null = event.key === 'ArrowLeft' ? [-1, 0] : event.key === 'ArrowRight' ? [1, 0] : event.key === 'ArrowUp' ? [0, -1] : event.key === 'ArrowDown' ? [0, 1] : null;
    if (!delta) return;
    event.preventDefault(); update(tile.key, { ...tile, x: Math.round(tile.x) + delta[0], y: Math.round(tile.y) + delta[1] }); setNotice(`${byKey.get(tile.key)?.label ?? 'App'} moved.`);
  };

  const resizeBy = (key: AppPreviewKey, amount: number) => {
    const tile = tiles.find((current) => current.key === key);
    if (!tile) return;
    interactionChangedRef.current = false; update(key, { ...tile, width: Math.round(tile.width) + amount });
    setNotice(`${byKey.get(key)?.label ?? 'App'} ${amount > 0 ? 'enlarged' : 'reduced'}.`);
  };

  const rotate = (key: AppPreviewKey) => {
    setPortrait((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    setNotice(`${byKey.get(key)?.label ?? 'App'} orientation changed.`);
  };

  const updateGridPointer = (event: PointerEvent<HTMLOListElement>) => {
    const bounds = gridBoundsRef.current;
    if (!bounds) return;
    gridPointRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    if (gridFrameRef.current !== null) return;
    gridFrameRef.current = window.requestAnimationFrame(() => {
      gridFrameRef.current = null;
      const overlay = gridOverlayRef.current; const glow = glowRef.current;
      if (!overlay || !glow) return;
      overlay.style.opacity = '1';
      glow.style.transform = `translate3d(${gridPointRef.current.x - glowRadiusRef.current}px, ${gridPointRef.current.y - glowRadiusRef.current}px, 0)`;
    });
  };

  const status = sync === 'live' ? 'Order broker live · pickup display synchronized' : sync === 'checking' ? 'Verifying local order broker…' : sync === 'hosted' ? 'Hosted surfaces use their configured data plane' : 'Order broker unavailable';
  return <section className="apps-preview-canvas-shell" aria-label="Production app simulator">
    <div className="apps-preview-canvas-toolbar"><p aria-live="polite" data-state={sync}>{status}</p><div><button onClick={() => { setTiles(initialTiles(previews)); setNotice('Layout reset.'); }} type="button">Reset</button></div></div>
    <p className="apps-preview-instructions" id="apps-preview-instructions" aria-live="polite">{notice} Drag the handle below a device, or drag its two-arrow corner grip to resize.</p>
    <ol className="apps-preview-grid" data-compact={compact || undefined} data-editing="true" onPointerLeave={() => { if (gridOverlayRef.current) gridOverlayRef.current.style.opacity = '0'; }} onPointerMove={updateGridPointer} ref={canvasRef}>
      <li aria-hidden="true" className="apps-preview-grid-spotlight" ref={gridOverlayRef}><span className="apps-preview-grid-glow" ref={glowRef} /></li>
      {tiles.map((tile) => {
        const preview = byKey.get(tile.key); if (!preview) return null;
        return <AppsPreviewTile canvas={canvas} compact={compact} key={tile.key} moving={interaction?.kind === 'move' && interaction.origin.key === tile.key} onDragEnd={endInteraction} onDragMove={moveInteraction} onDragStart={() => startInteraction(tile, 'move')} onKeyMove={(event) => keyboardMove(event, tile)} onResizeBy={(amount) => resizeBy(tile.key, amount)} onResizeEnd={endInteraction} onResizeMove={moveInteraction} onResizeStart={() => startInteraction(tile, 'resize')} onRotate={() => rotate(tile.key)} portrait={portrait.has(tile.key)} preview={preview} resizing={interaction?.kind === 'resize' && interaction.origin.key === tile.key} rotatable={ROTATABLE_APPS.has(tile.key)} tile={tile} />;
      })}
    </ol>
  </section>;
}
