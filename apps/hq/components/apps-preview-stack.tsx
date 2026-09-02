'use client';

import Link from 'next/link';

import type { AppPreview, AppPreviewKey } from '@/lib/app-previews';
import type { WallLayout } from '@/lib/app-wall-fit';
import { INITIAL_LAYOUT } from '@/lib/app-wall-geometry';

import { DevicePreviewFrame } from './device-preview-frame';
import { Icon } from './icon';

type StackProps = {
  readonly previews: readonly AppPreview[];
  readonly master: WallLayout;
  readonly rotatable: ReadonlySet<AppPreviewKey>;
  readonly onCommit: (layout: WallLayout) => void;
  readonly reducedMotion: boolean;
};

/**
 * The wall for a narrow window: one reading-order column of static frames.
 * Orientation still round-trips through the persisted layout, so a phone
 * that rotated the kiosk shows it rotated on the desk.
 */
export function AppsPreviewStack({ previews, master, rotatable, onCommit, reducedMotion }: StackProps) {
  const rotate = (key: AppPreviewKey) => onCommit({
    ...master,
    tiles: master.tiles.map((tile) => tile.key === key ? { ...tile, orientation: tile.orientation === 'portrait' ? 'landscape' : 'portrait' } : tile),
  });
  return (
    <section aria-label="Production app simulator" className="apps-preview-canvas-shell apps-preview-canvas-shell--stack">
      <ol className="apps-preview-stack">
        {previews.map((preview) => {
          const tile = master.tiles.find((entry) => entry.key === preview.key) ?? INITIAL_LAYOUT[preview.key];
          const portrait = tile.orientation === 'portrait';
          return (
            <li className="apps-preview-stack-card" data-orientation={tile.orientation} key={preview.key}>
              <div className="apps-preview-stack-stage" data-frame={preview.frame}>
                <DevicePreviewFrame frame={preview.frame} height={preview.viewport.height} orientation={tile.orientation} reducedMotion={reducedMotion} src={preview.url ?? 'about:blank'} title={`${preview.label} production preview`} width={preview.viewport.width} />
              </div>
              <p className="apps-wall-caption apps-wall-caption--stack"><strong>{preview.label}</strong><small>{preview.device}</small></p>
              <div className="apps-preview-stack-actions">
                {rotatable.has(preview.key) ? <button aria-label={`Rotate ${preview.label} to ${portrait ? 'landscape' : 'portrait'}`} className="apps-wall-chip apps-wall-chip--static" onClick={() => rotate(preview.key)} type="button"><Icon name="rotate" /></button> : null}
                <Link aria-label={`Edit ${preview.label}`} className="apps-wall-chip apps-wall-chip--static" href={preview.href}><Icon name="edit" /></Link>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
