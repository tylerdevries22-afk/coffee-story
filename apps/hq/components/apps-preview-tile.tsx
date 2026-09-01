'use client';

import Link from 'next/link';
import { motion, useDragControls, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

import type { AppPreview } from '@/lib/app-previews';

import type { AppPreviewTile } from './apps-preview-layout';
import { DevicePreviewFrame } from './device-preview-frame';
import { Icon } from './icon';

type Offset = { readonly x: number; readonly y: number };
type ResizePointer = { readonly id: number; readonly x: number; readonly y: number };
const CARD_SPRING = { damping: 36, mass: .78, restDelta: .001, stiffness: 480, type: 'spring' as const };
type TileProps = {
  readonly canvas: { readonly height: number; readonly width: number };
  readonly compact: boolean;
  readonly moving: boolean;
  readonly portrait: boolean;
  readonly preview: AppPreview;
  readonly resizing: boolean;
  readonly rotatable: boolean;
  readonly tile: AppPreviewTile;
  readonly onDragEnd: () => void;
  readonly onDragMove: (offset: Offset) => void;
  readonly onDragStart: () => void;
  readonly onKeyMove: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onResizeBy: (amount: number) => void;
  readonly onResizeEnd: () => void;
  readonly onResizeMove: (offset: Offset) => void;
  readonly onResizeStart: () => void;
  readonly onRotate: () => void;
};

function frameAspect(frame: AppPreview['frame']) {
  return frame === 'phone' ? .501 : frame === 'tv' ? 1.72 : frame === 'computer' ? 1.242 : 1.386;
}

/** The preview itself follows the pointer; adjacent tiles use spring settling from the board layout. */
export function AppsPreviewTile({ canvas, compact, moving, portrait, preview, resizing, rotatable, tile, onDragEnd, onDragMove, onDragStart, onKeyMove, onResizeBy, onResizeEnd, onResizeMove, onResizeStart, onRotate }: TileProps) {
  const dragControls = useDragControls();
  const reducedMotion = useReducedMotion();
  const resizeRef = useRef<ResizePointer | null>(null);
  const cellWidth = canvas.width / 60;
  const cellHeight = canvas.height / 48;
  const tileWidth = tile.width * cellWidth;
  const maxX = Math.max(0, canvas.width - tileWidth);
  const maxY = Math.max(0, canvas.height - tileWidth / frameAspect(preview.frame));
  const position = compact ? { x: 0, y: 0 } : { x: tile.x * cellWidth, y: tile.y * cellHeight };
  const startMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0 && !compact) dragControls.start(event);
  };
  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || compact) return;
    event.preventDefault(); event.stopPropagation();
    resizeRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId); onResizeStart();
  };
  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = resizeRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    onResizeMove({ x: event.clientX - pointer.x, y: event.clientY - pointer.y });
  };
  const endResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.id !== event.pointerId) return;
    resizeRef.current = null; onResizeEnd();
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    const amount = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!amount) return;
    event.preventDefault(); onResizeBy(amount);
  };

  return (
    <motion.li
      animate={moving ? undefined : position}
      className={`apps-preview-card apps-preview-card--${preview.frame}`}
      data-dragging={moving || undefined}
      data-resizing={resizing || undefined}
      drag={!compact}
      dragConstraints={{ bottom: maxY, left: 0, right: maxX, top: 0 }}
      dragControls={dragControls}
      dragElastic={reducedMotion ? 0 : .08}
      dragListener={false}
      dragMomentum={false}
      initial={false}
      key={tile.key}
      onDrag={(_, info) => onDragMove(info.offset)}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      style={{ '--canvas-width': tile.width } as CSSProperties}
      transition={reducedMotion ? { duration: 0 } : CARD_SPRING}
    >
      <article>
        <header className="apps-preview-card-header">
          <span className="apps-preview-card-copy"><strong>{preview.label}</strong><small>{preview.device}</small></span>
          <span className="apps-preview-card-actions">
            {rotatable ? <button aria-label={`Rotate ${preview.label} to ${portrait ? 'landscape' : 'portrait'}`} className="apps-preview-icon-button" onClick={onRotate} type="button"><Icon name="rotate" size={16} /></button> : null}
            <Link aria-label={`Edit ${preview.label}`} className="apps-preview-icon-button" href={preview.href}><Icon name="edit" size={16} /></Link>
          </span>
        </header>
        <div className="apps-preview-stage">
          <DevicePreviewFrame frame={preview.frame} height={preview.viewport.height} loading="eager" orientation={portrait ? 'portrait' : 'landscape'} src={preview.url ?? 'about:blank'} title={`${preview.label} production preview`} width={preview.viewport.width} />
          <button aria-describedby="apps-preview-instructions" aria-keyshortcuts="ArrowDown ArrowLeft ArrowRight ArrowUp" aria-label={`Resize ${preview.label}`} className="apps-preview-resize" onKeyDown={resizeWithKeys} onPointerCancel={endResize} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} type="button"><Icon name="resize" size={16} /></button>
        </div>
        <footer className="apps-preview-card-footer">
          <button aria-describedby="apps-preview-instructions" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label={`Move ${preview.label}`} className="apps-layout-grip" onKeyDown={onKeyMove} onPointerDown={startMove} type="button"><Icon name="drag" size={16} /></button>
        </footer>
      </article>
    </motion.li>
  );
}
