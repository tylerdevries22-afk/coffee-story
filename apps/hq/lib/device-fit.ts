import type { AppPreviewFrame } from '@/lib/app-previews';

import type { Size } from './app-wall-geometry';

export type Artwork = {
  readonly asset?: string;
  readonly left: number;
  readonly top: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
};

/** Where each silhouette's screen sits, as fractions of the artwork's landscape box. */
export const ARTWORK: Readonly<Record<AppPreviewFrame, Artwork>> = {
  computer: { asset: '/device-frames/imac.png', left: .040694519805, top: .050573162508, screenWidth: .918610960391, screenHeight: .64194200944 },
  phone: { asset: '/device-frames/iphone-x.png', left: .068870523416, top: .031855955679, screenWidth: .862258953168, screenHeight: .936288088643 },
  tablet: { asset: '/device-frames/ipad-pro-landscape.png', left: .070440251572, top: .054054054054, screenWidth: .859119496855, screenHeight: .892327811683 },
  tv: { left: .02, top: .035, screenWidth: .96, screenHeight: .93 },
};

export type FittedDevice = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly angle: number;
};

/** The unscaled chassis around a viewport, in the viewport's own pixels. */
export function chassisSize(viewport: Size, art: Artwork): Size {
  return { width: viewport.width / art.screenWidth, height: viewport.height / art.screenHeight };
}

/**
 * Fits a chassis rotated by `angleDeg` inside the stage: the rotated bounding
 * box is what has to fit, so at 0 and 90 degrees this is the plain fit and in
 * between it pulls back for the diagonal, keeping the artwork inside the tile
 * on every frame of a turn.
 */
export function fitRotatedDevice(stage: Size, chassis: Size, angleDeg: number): FittedDevice {
  const radians = angleDeg * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const boundWidth = chassis.width * cos + chassis.height * sin;
  const boundHeight = chassis.width * sin + chassis.height * cos;
  const raw = Math.min(stage.width / boundWidth, stage.height / boundHeight);
  const scale = Number.isFinite(raw) && raw > 0 ? raw : .01;
  const width = boundWidth * scale;
  const height = boundHeight * scale;
  return { left: Math.max(0, (stage.width - width) / 2), top: Math.max(0, (stage.height - height) / 2), width, height, scale, angle: angleDeg };
}

/** The CSS transform that places a centre-origin chassis according to a fit. */
export function chassisTransform(fit: FittedDevice, chassis: Size): string {
  const dx = fit.left + fit.width / 2 - chassis.width / 2;
  const dy = fit.top + fit.height / 2 - chassis.height / 2;
  return `translate3d(${dx}px, ${dy}px, 0) rotate(${fit.angle}deg) scale(${fit.scale})`;
}

/** The silhouette's rectangle as custom properties, so chips and caption anchor to the same numbers. */
export function deviceRectVars(fit: FittedDevice): Record<string, string> {
  return {
    '--device-left': `${fit.left}px`,
    '--device-top': `${fit.top}px`,
    '--device-width': `${fit.width}px`,
    '--device-height': `${fit.height}px`,
    '--device-angle': `${fit.angle}deg`,
  };
}
