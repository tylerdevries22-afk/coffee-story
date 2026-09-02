'use client';

import { animate } from 'framer-motion';
import { useCallback, useEffect, useRef } from 'react';

import type { AppPreviewKey } from '@/lib/app-previews';
import { beginResize, beginTurn, endResize, finishTurn, moveTile, turnTargetOf, updateResize, updateTurn } from '@/lib/app-wall-gestures';
import type { Point } from '@/lib/app-wall-geometry';
import { springTransition } from '@/lib/app-wall-motion';
import { beginDrag, releaseDrag, tileOf, updateDrag, type Corner, type WallState } from '@/lib/app-wall-sim';

import type { useWallCore } from './use-wall-simulation';

type Core = ReturnType<typeof useWallCore>;
export type WallNotice = 'moving' | 'resizing' | 'placed' | 'resized' | 'refused' | 'moved' | 'enlarged' | 'reduced' | 'rotated' | 'rotate-refused';
type PendingPointer =
  | { readonly kind: 'drag'; readonly offset: Point; readonly velocity: Point }
  | { readonly kind: 'resize'; readonly offset: Point };

/** Drag, resize, keyboard and rotate, expressed against the simulation and finished through one settle path. */
export function useWallGestures(core: Core, onNotice: (notice: WallNotice, key: AppPreviewKey) => void) {
  const { stateRef, motionFor, schedule, commitState, setPhase, cellRef, reducedRef, handoffRef } = core;
  const turnToken = useRef(0);
  const unsubscribeTurn = useRef<(() => void) | null>(null);
  const pointerFrame = useRef<number | null>(null);
  const pendingPointer = useRef<PendingPointer | null>(null);
  /** What to announce when the current gesture lands; decided at landing, because a coast can still be refused. */
  const landing = useRef<WallNotice>('placed');
  const toCells = useCallback((point: Point): Point => ({ x: point.x / cellRef.current, y: point.y / cellRef.current }), [cellRef]);

  /** Reflow at most once per painted frame; retain the newest pointer sample. */
  const processPointer = useCallback(() => {
    const pending = pendingPointer.current;
    pendingPointer.current = null;
    const state = stateRef.current;
    if (!pending || !state) return;
    if (pending.kind === 'drag' && state.active?.phase === 'dragging') {
      stateRef.current = updateDrag(state, toCells(pending.offset), toCells(pending.velocity)); schedule();
    }
    if (pending.kind === 'resize' && state.active?.phase === 'resizing') {
      stateRef.current = updateResize(state, toCells(pending.offset)); schedule();
    }
  }, [schedule, stateRef, toCells]);
  const flushPointer = useCallback(() => {
    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    processPointer();
  }, [processPointer]);
  const queuePointer = useCallback((pending: PendingPointer) => {
    pendingPointer.current = pending;
    if (pointerFrame.current !== null) return;
    pointerFrame.current = window.requestAnimationFrame(() => { pointerFrame.current = null; processPointer(); });
  }, [processPointer]);

  useEffect(() => () => { if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current); }, []);

  /** Marks the gesture as landing; the sync loop springs the rest into place and commits when it settles. */
  const beginSettle = useCallback((state: WallState) => {
    const active = state.active;
    if (!active) return;
    stateRef.current = state;
    setPhase({ key: active.key, phase: 'settling' });
    onNotice(state.refused ? (landing.current === 'rotated' ? 'rotate-refused' : 'refused') : landing.current, active.key);
    schedule();
  }, [onNotice, schedule, setPhase, stateRef]);

  useEffect(() => { handoffRef.current = beginSettle; return () => { handoffRef.current = null; }; }, [beginSettle, handoffRef]);

  // A coast in a hidden tab would replay stale time on return; drop its speed so the next frame hands off.
  useEffect(() => {
    const onVisibility = () => {
      const state = stateRef.current;
      if (document.visibilityState === 'hidden' && state?.active?.phase === 'coasting' && state.active.coast) {
        stateRef.current = { ...state, active: { ...state.active, coast: { ...state.active.coast, velocity: { x: 0, y: 0 } } } };
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stateRef]);

  const dragStart = (key: AppPreviewKey) => {
    const state = stateRef.current;
    if (!state || state.active) return;
    stateRef.current = beginDrag(state, key); setPhase({ key, phase: 'dragging' }); onNotice('moving', key); schedule();
  };
  const dragMove = (offset: Point, velocity: Point) => {
    if (stateRef.current?.active?.phase === 'dragging') queuePointer({ kind: 'drag', offset, velocity });
  };
  const dragEnd = (offset: Point, velocity: Point) => {
    queuePointer({ kind: 'drag', offset, velocity }); flushPointer();
    const state = stateRef.current;
    if (state?.active?.phase !== 'dragging') return;
    const released = releaseDrag(state, toCells(velocity));
    landing.current = 'placed';
    if (released.active?.phase === 'settling') beginSettle(released); else { stateRef.current = released; setPhase({ key: state.active.key, phase: 'coasting' }); schedule(); }
  };
  const resizeStart = (key: AppPreviewKey, corner: Corner) => {
    const state = stateRef.current;
    if (!state || state.active) return;
    stateRef.current = beginResize(state, key, corner); setPhase({ key, phase: 'resizing' }); onNotice('resizing', key); schedule();
  };
  const resizeMove = (offset: Point) => {
    if (stateRef.current?.active?.phase === 'resizing') queuePointer({ kind: 'resize', offset });
  };
  const resizeEnd = (offset: Point = { x: 0, y: 0 }) => {
    queuePointer({ kind: 'resize', offset }); flushPointer();
    const state = stateRef.current;
    if (state?.active?.phase !== 'resizing') return;
    landing.current = 'resized';
    beginSettle(endResize(state));
  };
  const nudge = (key: AppPreviewKey, dx: number, dy: number) => {
    const state = stateRef.current;
    const tile = state ? tileOf(state, key) : undefined;
    if (!state || !tile || state.active) return;
    const moved = moveTile(state, key, { ...tile, x: Math.round(tile.x) + dx, y: Math.round(tile.y) + dy });
    onNotice(moved.refused ? 'refused' : 'moved', key);
    commitState(moved);
  };
  const resizeBy = (key: AppPreviewKey, amount: number) => {
    const state = stateRef.current;
    const tile = state ? tileOf(state, key) : undefined;
    if (!state || !tile || state.active) return;
    const resized = moveTile(state, key, { ...tile, width: Math.round(tile.width) + amount, sized: true });
    onNotice(resized.refused ? 'refused' : amount > 0 ? 'enlarged' : 'reduced', key);
    commitState(resized);
  };
  /** A spring drives the turn; each change of the spring reshapes the collision footprint, so neighbours yield live. */
  const rotate = (key: AppPreviewKey) => {
    const state = stateRef.current;
    if (!state) return;
    const motion = motionFor(key);
    const turning = state.active?.key === key && state.active.phase === 'turning';
    if (state.active && !turning) return;
    const began = turning ? state : beginTurn(state, key);
    if (!began) { onNotice('rotate-refused', key); return; }
    const target = turning ? 1 - Math.round(motion.turn.get()) : turnTargetOf(began.active?.origin.orientation === 'portrait' ? 'landscape' : 'portrait');
    stateRef.current = began; setPhase({ key, phase: 'turning' });
    const token = turnToken.current + 1;
    turnToken.current = token;
    unsubscribeTurn.current?.();
    unsubscribeTurn.current = motion.turn.on('change', (t) => {
      const latest = stateRef.current;
      if (latest?.active?.key === key && latest.active.phase === 'turning') { stateRef.current = updateTurn(latest, t); schedule(); }
    });
    void animate(motion.turn, target, springTransition('turn', reducedRef.current)).then(() => {
      if (turnToken.current !== token) return;
      unsubscribeTurn.current?.(); unsubscribeTurn.current = null;
      const latest = stateRef.current;
      if (latest?.active?.key !== key || latest.active.phase !== 'turning') return;
      // Land exactly on the target: the spring may resolve a hair early, and
      // text is only crisp at a rotation of exactly 0 or 90.
      motion.turn.set(target);
      landing.current = 'rotated';
      beginSettle(finishTurn(latest, target));
    });
    schedule();
  };
  return { dragStart, dragMove, dragEnd, resizeStart, resizeMove, resizeEnd, nudge, resizeBy, rotate };
}
