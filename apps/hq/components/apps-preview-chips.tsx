'use client';

import Link from 'next/link';
import type { KeyboardEvent } from 'react';

import type { AppPreview } from '@/lib/app-previews';
import type { Point } from '@/lib/app-wall-geometry';
import type { Corner } from '@/lib/app-wall-sim';

import { Icon } from './icon';
import { useWallPointer } from './use-wall-pointer';

export type WallChipRailProps = {
  readonly preview: AppPreview;
  readonly portrait: boolean;
  readonly rotatable: boolean;
  readonly rotateDisabled: boolean;
  readonly onDragStart: () => void;
  readonly onDragMove: (offset: Point, velocity: Point) => void;
  readonly onDragEnd: (offset: Point, velocity: Point) => void;
  readonly onKeyMove: (dx: number, dy: number) => void;
  readonly onResizeStart: (corner: Corner) => void;
  readonly onResizeMove: (offset: Point) => void;
  readonly onResizeEnd: (offset: Point) => void;
  readonly onResizeBy: (amount: number) => void;
  readonly onRotate: () => void;
};

const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
const CORNER_LABEL: Readonly<Record<Corner, string>> = { nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' };

type ResizeChipProps = { readonly corner: Corner; readonly label: string; readonly onStart: () => void; readonly onMove: (offset: Point) => void; readonly onEnd: (offset: Point) => void; readonly onResizeBy: (amount: number) => void };

function ResizeChip({ corner, label, onStart, onMove, onEnd, onResizeBy }: ResizeChipProps) {
  const pointer = useWallPointer<HTMLButtonElement>({ onStart, onMove: (offset) => onMove(offset), onEnd: (offset) => onEnd(offset) });
  const withKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = ARROWS[event.key];
    if (!delta) { pointer.onKeyDown(event); return; }
    event.preventDefault(); onResizeBy(delta[0] || delta[1]);
  };
  return <button aria-describedby="apps-preview-instructions" aria-keyshortcuts="ArrowDown ArrowLeft ArrowRight ArrowUp" aria-label={`Resize ${label} from the ${CORNER_LABEL[corner]}`} className={`apps-wall-chip apps-wall-chip--resize apps-wall-chip--${corner}`} onKeyDown={withKeys} onLostPointerCapture={pointer.onLostPointerCapture} onPointerCancel={pointer.onPointerCancel} onPointerDown={pointer.onPointerDown} onPointerMove={pointer.onPointerMove} onPointerUp={pointer.onPointerUp} type="button"><Icon name="resize" /></button>;
}

/**
 * The controls of one frame, anchored to the silhouette by the `--device-*`
 * variables the device frame publishes, so they ride the same numbers as the
 * artwork through a rotate or a resize. Tab order: grip, rotate, edit, then
 * the four corner handles; any corner resizes about the one opposite it.
 */
export function WallChipRail({ preview, portrait, rotatable, rotateDisabled, onDragStart, onDragMove, onDragEnd, onKeyMove, onResizeStart, onResizeMove, onResizeEnd, onResizeBy, onRotate }: WallChipRailProps) {
  const grip = useWallPointer<HTMLButtonElement>({ onStart: onDragStart, onMove: onDragMove, onEnd: onDragEnd });
  const moveWithKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = ARROWS[event.key];
    if (!delta) { grip.onKeyDown(event); return; }
    event.preventDefault(); onKeyMove(delta[0], delta[1]);
  };
  return (
    <>
      <button aria-describedby="apps-preview-instructions" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label={`Move ${preview.label}`} className="apps-wall-chip apps-wall-chip--grip" onKeyDown={moveWithKeys} onLostPointerCapture={grip.onLostPointerCapture} onPointerCancel={grip.onPointerCancel} onPointerDown={grip.onPointerDown} onPointerMove={grip.onPointerMove} onPointerUp={grip.onPointerUp} type="button"><Icon name="drag" /></button>
      {rotatable ? <button aria-disabled={rotateDisabled || undefined} aria-label={`Rotate ${preview.label} to ${portrait ? 'landscape' : 'portrait'}`} className="apps-wall-chip apps-wall-chip--rotate" onClick={() => { if (!rotateDisabled) onRotate(); }} type="button"><Icon name="rotate" /></button> : null}
      <Link aria-label={`Edit ${preview.label}`} className="apps-wall-chip apps-wall-chip--edit" href={preview.href}><Icon name="edit" /></Link>
      {CORNERS.map((corner) => <ResizeChip corner={corner} key={corner} label={preview.label} onEnd={onResizeEnd} onMove={onResizeMove} onResizeBy={onResizeBy} onStart={() => onResizeStart(corner)} />)}
    </>
  );
}
