'use client';

import { motion, useTransform, type MotionStyle } from 'framer-motion';
import { useRef } from 'react';

import type { AppPreviewTile } from '@/lib/app-wall-geometry';
import type { Phase } from '@/lib/app-wall-sim';

import { WallChipRail, type WallChipRailProps } from './apps-preview-chips';
import { DevicePreviewFrame } from './device-preview-frame';
import type { TileMotion } from './use-wall-simulation';

type TileProps = Omit<WallChipRailProps, 'portrait' | 'rotateDisabled'> & {
  readonly motion: TileMotion;
  readonly phase: Phase;
  readonly ready: boolean;
  readonly reducedMotion: boolean;
  readonly tile: AppPreviewTile;
};

const sum = ([rest, kinetic]: number[]) => (rest ?? 0) + (kinetic ?? 0);

/**
 * One frame on the wall. Position is rest plus kinetic offset, both motion
 * values written by the simulation, so no frame of a drag, coast or turn
 * passes through React; React only sees phase and orientation changes.
 */
export function AppsPreviewTile({ motion: values, phase, preview, ready, reducedMotion, tile, ...chips }: TileProps) {
  const anchorRef = useRef<HTMLElement>(null);
  const x = useTransform([values.restX, values.kinX], sum);
  const y = useTransform([values.restY, values.kinY], sum);
  const captionId = `apps-wall-caption-${tile.key}`;
  const busy = phase === 'dragging' || phase === 'resizing' || phase === 'coasting';
  return (
    <motion.li
      aria-labelledby={captionId}
      className="apps-preview-card"
      data-orientation={tile.orientation}
      data-phase={phase}
      data-ready={ready || undefined}
      data-rotatable={chips.rotatable}
      style={{ x, y, '--tile-w': values.width, '--tile-h': values.height } as unknown as MotionStyle}
    >
      <article className="apps-wall-frame" ref={anchorRef}>
        <div className="apps-preview-stage">
          <DevicePreviewFrame anchorRef={anchorRef} frame={preview.frame} height={preview.viewport.height} loading="eager" reducedMotion={reducedMotion} src={preview.url ?? 'about:blank'} title={`${preview.label} production preview`} turn={values.turn} width={preview.viewport.width} />
          <WallChipRail {...chips} portrait={tile.orientation === 'portrait'} preview={preview} rotateDisabled={busy} />
        </div>
        <p className="apps-wall-caption" id={captionId}><strong>{preview.label}</strong><small>{preview.device}</small></p>
      </article>
    </motion.li>
  );
}
