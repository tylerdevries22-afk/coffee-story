'use client';

import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import type { Point } from '@/lib/app-wall-geometry';
import { estimateVelocity, pushSample, type PointerSample } from '@/lib/app-wall-velocity';

export type PointerGesture = {
  readonly onStart: () => void;
  readonly onMove: (offset: Point, velocity: Point) => void;
  readonly onEnd: (offset: Point, velocity: Point) => void;
};

type Tracking = { readonly id: number; readonly startX: number; readonly startY: number; samples: PointerSample[] };

const STILL: Point = { x: 0, y: 0 };

/**
 * One pointer at a time on a grip: captured so the gesture survives leaving
 * the element, sampled so a release knows how fast the hand was moving, and
 * ended with zero velocity when the browser cancels it or Escape is pressed.
 */
export function useWallPointer<T extends HTMLElement>(gesture: PointerGesture) {
  const tracking = useRef<Tracking | null>(null);
  const offsetFor = (current: Tracking): Point => {
    const last = current.samples[current.samples.length - 1];
    return last ? { x: last.x - current.startX, y: last.y - current.startY } : STILL;
  };
  const finish = (velocity: Point, offset?: Point) => {
    const current = tracking.current;
    if (!current) return;
    tracking.current = null;
    gesture.onEnd(offset ?? offsetFor(current), velocity);
  };
  return {
    onPointerDown: (event: PointerEvent<T>) => {
      if (event.button !== 0 || !event.isPrimary || tracking.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      tracking.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }] };
      gesture.onStart();
    },
    onPointerMove: (event: PointerEvent<T>) => {
      const current = tracking.current;
      if (!current || current.id !== event.pointerId) return;
      current.samples = pushSample(current.samples, { x: event.clientX, y: event.clientY, time: event.timeStamp });
      gesture.onMove({ x: event.clientX - current.startX, y: event.clientY - current.startY }, estimateVelocity(current.samples, event.timeStamp));
    },
    onPointerUp: (event: PointerEvent<T>) => {
      const current = tracking.current;
      if (!current || current.id !== event.pointerId) return;
      current.samples = pushSample(current.samples, { x: event.clientX, y: event.clientY, time: event.timeStamp });
      finish(estimateVelocity(current.samples, event.timeStamp), { x: event.clientX - current.startX, y: event.clientY - current.startY });
    },
    onPointerCancel: () => finish(STILL),
    onLostPointerCapture: () => finish(STILL),
    onKeyDown: (event: KeyboardEvent<T>) => { if (event.key === 'Escape') finish(STILL); },
  };
}
