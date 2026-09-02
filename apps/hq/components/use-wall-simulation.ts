'use client';

import { animate, motionValue, type MotionValue } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppPreviewKey } from '@/lib/app-previews';
import { fillLayout, fitLayout, type FitMode, type WallLayout } from '@/lib/app-wall-fit';
import { turnTargetOf } from '@/lib/app-wall-gestures';
import { heightOf, layoutsMatch, type AppPreviewTile, type WallBounds } from '@/lib/app-wall-geometry';
import { springTransition } from '@/lib/app-wall-motion';
import { createWallState, kineticsOf, settle, stepWall, SUBSTEP, tileOf, wallAtRest, type Phase, type WallState } from '@/lib/app-wall-sim';

/** Every number the view needs for one tile, as motion values so no frame passes through React. */
export type TileMotion = {
  readonly restX: MotionValue<number>;
  readonly restY: MotionValue<number>;
  readonly kinX: MotionValue<number>;
  readonly kinY: MotionValue<number>;
  readonly width: MotionValue<number>;
  readonly height: MotionValue<number>;
  /** 0 landscape, 1 portrait; the chassis angle and the footprint morph both derive from it. */
  readonly turn: MotionValue<number>;
};

export type ActivePhase = { readonly key: AppPreviewKey; readonly phase: Phase };
type Targets = { x: number; y: number; w: number; h: number };

export type WallCoreOptions = {
  readonly master: WallLayout;
  readonly bounds: WallBounds;
  readonly ready: boolean;
  readonly cell: number;
  readonly reduced: boolean;
  readonly onCommit: (layout: WallLayout) => void;
};

/** The one rAF loop, the motion values, and the commit path; gestures build on this. */
export function useWallCore({ master, bounds, ready, cell, reduced, onCommit }: WallCoreOptions) {
  const stateRef = useRef<WallState | null>(null);
  const motions = useRef(new Map<AppPreviewKey, TileMotion>());
  const targets = useRef(new Map<AppPreviewKey, Targets>());
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const cellRef = useRef(cell);
  const boundsRef = useRef(bounds);
  const reducedRef = useRef(reduced);
  const commitRef = useRef(onCommit);
  /** Called when a coast finishes on its own; the gesture layer hands the snapped rest to the settle spring. */
  const handoffRef = useRef<((state: WallState) => void) | null>(null);
  /** The settle in progress: how many rest springs are still moving, and whether the commit has fired. */
  const settlingRef = useRef<{ key: AppPreviewKey; pending: number; done: boolean } | null>(null);
  const commitFnRef = useRef<((state: WallState) => void) | null>(null);
  const [tiles, setTiles] = useState<AppPreviewTile[]>(() => master.tiles.slice());
  const [phase, setPhase] = useState<ActivePhase | null>(null);
  const [mode, setMode] = useState<FitMode>('fitted');
  const [canvasRows, setCanvasRows] = useState(() => Math.max(bounds.rows, master.rowFloor ?? 0));
  const canvasRowsRef = useRef(canvasRows);
  cellRef.current = cell; boundsRef.current = bounds; reducedRef.current = reduced; commitRef.current = onCommit;

  const motionFor = useCallback((key: AppPreviewKey): TileMotion => {
    const existing = motions.current.get(key);
    if (existing) return existing;
    const tile = stateRef.current ? tileOf(stateRef.current, key) : master.tiles.find((entry) => entry.key === key);
    const created: TileMotion = {
      restX: motionValue(0), restY: motionValue(0), kinX: motionValue(0), kinY: motionValue(0),
      width: motionValue(tile?.width ?? 0), height: motionValue(tile ? heightOf(tile) : 0), turn: motionValue(turnTargetOf(tile?.orientation ?? 'landscape')),
    };
    motions.current.set(key, created);
    return created;
  }, [master.tiles]);

  /** Writes the simulation into the motion values: the held tile jumps, everything else springs. */
  const syncMotion = useCallback((state: WallState, immediate = false) => {
    if (Math.abs(canvasRowsRef.current - state.canvas.rows) >= .01) {
      canvasRowsRef.current = state.canvas.rows;
      setCanvasRows(state.canvas.rows);
    }
    const px = cellRef.current;
    const spring = springTransition('settle', reducedRef.current);
    const settlingKey = state.active?.phase === 'settling' ? state.active.key : null;
    if (settlingRef.current && settlingRef.current.key !== settlingKey) settlingRef.current = null;
    if (settlingKey && !settlingRef.current) settlingRef.current = { key: settlingKey, pending: 0, done: false };
    const settling = settlingRef.current;
    const landed = () => {
      if (!settling || settling.done || settling.pending > 0) return;
      settling.done = true;
      const latest = stateRef.current;
      if (latest?.active?.key === settling.key && latest.active.phase === 'settling') commitFnRef.current?.(latest);
    };
    for (const tile of state.tiles) {
      const motion = motionFor(tile.key);
      const kinetics = kineticsOf(state, tile.key);
      motion.kinX.set(kinetics.offset.x * px); motion.kinY.set(kinetics.offset.y * px);
      const active = state.active?.key === tile.key ? state.active : null;
      const footprint = active?.footprint ?? { width: tile.width, height: heightOf(tile) };
      const next: Targets = { x: tile.x * px, y: tile.y * px, w: footprint.width, h: footprint.height };
      const held = active !== null && active.phase !== 'settling';
      const previous = targets.current.get(tile.key);
      const pairs = [[motion.restX, next.x, previous?.x], [motion.restY, next.y, previous?.y], [motion.width, next.w, previous?.w], [motion.height, next.h, previous?.h]] as const;
      for (const [value, target, last] of pairs) {
        if (held || immediate) { if (value.get() !== target) value.set(target); continue; }
        if (last === target) continue;
        if (settling && !settling.done && active?.phase === 'settling') {
          // The landing tile carries the coast's residual velocity into its spring, and the commit waits for it.
          const velocity = (value === motion.restX ? state.handoff?.x : value === motion.restY ? state.handoff?.y : 0) ?? 0;
          settling.pending += 1;
          animate(value, target, { ...springTransition('settle', reducedRef.current, { velocity: velocity * px }), onComplete: () => { settling.pending -= 1; landed(); } });
        } else animate(value, target, spring);
      }
      targets.current.set(tile.key, next);
      if (active?.phase === 'settling') landed();
      if (!active) {
        const turnTarget = turnTargetOf(tile.orientation);
        if (Math.abs(motion.turn.get() - turnTarget) > .001) { if (immediate) motion.turn.set(turnTarget); else animate(motion.turn, turnTarget, springTransition('turn', reducedRef.current)); }
      }
    }
  }, [motionFor]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame((now) => {
      frameRef.current = null;
      const state = stateRef.current;
      if (!state) return;
      const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : SUBSTEP;
      lastTimeRef.current = now;
      const next = stepWall(state, dt);
      stateRef.current = next;
      syncMotion(next);
      if (state.active?.phase === 'coasting' && next.active?.phase === 'settling') handoffRef.current?.(next);
      if (next.active || !wallAtRest(next)) schedule(); else lastTimeRef.current = 0;
    });
  }, [syncMotion]);

  /** The wall goes idle: fill around the change, make it the master, persist. */
  const commitState = useCallback((state: WallState) => {
    const idle = settle(state);
    const canvas = { columns: boundsRef.current.columns, rows: Math.max(boundsRef.current.rows, idle.canvas.rows) };
    // Pack and grow around the change; a wall the pack cannot seat is refitted, scaling down until it can.
    const filled = fillLayout(idle.tiles, canvas) ?? fitLayout({ bounds: canvas, tiles: idle.tiles }, canvas).tiles;
    const next: WallState = { ...idle, tiles: filled, canvas };
    stateRef.current = next;
    targets.current.forEach((entry, key) => { if (!filled.some((tile) => tile.key === key)) targets.current.delete(key); });
    setTiles(filled); setPhase(null);
    syncMotion(next);
    const rowFloor = canvas.rows > boundsRef.current.rows + 1 ? canvas.rows : undefined;
    commitRef.current({ bounds: canvas, tiles: filled, ...(rowFloor ? { rowFloor } : {}) });
    schedule();
  }, [schedule, syncMotion]);
  commitFnRef.current = commitState;

  useEffect(() => {
    if (!ready) return;
    const current = stateRef.current;
    // A gesture owns the wall until it commits; the commit reads the latest bounds itself.
    if (current?.active) return;
    const canvas = { ...bounds, rows: Math.max(bounds.rows, master.rowFloor ?? 0) };
    const fitted = fitLayout(master, canvas);
    setMode(fitted.mode);
    const next = createWallState(fitted.tiles, canvas, reduced);
    stateRef.current = next;
    if (!current || !layoutsMatch(current.tiles, fitted.tiles)) setTiles(fitted.tiles);
    syncMotion(next, !current);
    schedule();
  }, [master, bounds, ready, reduced, schedule, syncMotion]);

  useEffect(() => () => { if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current); }, []);

  return { stateRef, tiles, phase, mode, canvasRows, motionFor, syncMotion, schedule, commitState, setPhase, cellRef, reducedRef, handoffRef };
}
