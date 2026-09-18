import { MENU_IMAGE_SPEC } from './menu-image-contract';

/**
 * Where the square is cut from a non-square source, as a fraction of height.
 *
 * A drink sits low in frame and its saucer matters more than the ceiling, so
 * the square's centre sits a little below the source's. This lived in
 * scripts/menu-image-runtime.ts; it is here so the console's demo factory
 * crops a prospect's photographs exactly as the normaliser crops a tenant's,
 * without the console importing a script.
 */
export const MENU_CROP_CENTER = 0.55;

export type MenuImageCropWindow = {
  readonly left: number;
  readonly top: number;
  /** Edge of the square, in source pixels. */
  readonly side: number;
};

/** The largest square the source allows, centred across and biased low. */
export function menuImageCropWindow(width: number, height: number): MenuImageCropWindow {
  const side = Math.min(width, Math.round(height * MENU_IMAGE_SPEC.aspect));
  const top = Math.round(Math.min(Math.max(height * MENU_CROP_CENTER - side / 2, 0), height - side));
  const left = Math.round((width - side) / 2);
  return { left, top, side };
}
