/**
 * The glass feature row's geometry and motion.
 *
 * The home screen's photographic feature rows cut their half-capsule out of the
 * photograph itself: `borderRadius: 999` on two corners of the image, and
 * `contentFit="cover"` to guarantee the frame is full. Neither survives a
 * cut-out — there is no rectangle to round, and nothing that may be cropped.
 *
 * So the capsule becomes a shape of its own *behind* the glass, keeping the
 * same bleed and the same 186pt silhouette the section rhythm is built on, and
 * the glass stands on it, fully on screen, overhanging its top edge. Slicing a
 * photograph at the screen edge reads as a frame continuing; slicing a cut-out
 * glass at the screen edge reads as a mistake.
 *
 * Pure and asset-free so `node:test` can reach it. Three of the constants below
 * are the photographic row's own numbers, quoted rather than re-chosen, so the
 * copy column starts in exactly the same place — `home-screen.test.ts` pins
 * them against the live style values.
 */
// The deep path, not the barrel: `@platform/ui`'s index pulls in .tsx that
// imports react-native, which `node:test` cannot transform. The normaliser
// script imports this module the same way and for the same reason.
import { PRODUCT_CUTOUT_SPEC } from '@platform/ui/src/product-cutout';

/** = `styles.featureImage.width`. The media slot occupies the same column. */
export const SLOT_WIDTH = 164;
/** = `styles.featureImage.height`. The ground keeps the photographic silhouette. */
export const GROUND_HEIGHT = 186;
/** = `-styles.featureImageLeft.marginLeft`. The ground bleeds; the glass does not. */
export const BLEED = 32;

/** The part of the slot the guest can actually see. */
export const VISIBLE_WIDTH = SLOT_WIDTH - BLEED;

/**
 * The drink itself, rim to base.
 *
 * Everything below is derived from this and the seat contract, because the
 * only number a person can reason about is how tall the glass looks — not how
 * tall the transparent box around it is. The first version of this module got
 * that backwards, sized the box, and produced a glass that floated in its own
 * padding with the shadow pinned to the box rather than to the drink.
 */
export const GLASS_VISUAL_HEIGHT = 190;
/** How far the rim rises above the capsule: an object standing, not a print. */
export const GLASS_OVERHANG = 24;

export const GLASS_PARALLAX = 14;
export const GROUND_PARALLAX = 5;

/**
 * The render box: the master's whole frame, which `contain` needs in order to
 * be exact, and which is mostly transparent either side of the drink.
 */
export const GLASS_BOX_HEIGHT = Math.round(GLASS_VISUAL_HEIGHT / PRODUCT_CUTOUT_SPEC.seat.glassHeight);
export const GLASS_BOX_WIDTH = Math.round(GLASS_BOX_HEIGHT * PRODUCT_CUTOUT_SPEC.aspect);

/** Where the drink sits inside that box, straight off the seat fractions. */
const BOX_TO_GLASS_TOP = Math.round(
  GLASS_BOX_HEIGHT * (PRODUCT_CUTOUT_SPEC.seat.baseline - PRODUCT_CUTOUT_SPEC.seat.glassHeight),
);
const BOX_TO_GLASS_BASE = Math.round(GLASS_BOX_HEIGHT * PRODUCT_CUTOUT_SPEC.seat.baseline);

/**
 * Room above the ground for the overhang, the box's own top padding, and the
 * whole parallax travel.
 *
 * Android clips children that overflow their parent and `styles.feature` sets
 * no `overflow`, so the slot is sized to contain every layer at every point of
 * its animation rather than trusting overflow to behave.
 */
export const GROUND_TOP = GLASS_PARALLAX + GLASS_OVERHANG + BOX_TO_GLASS_TOP;
export const SLOT_HEIGHT = GROUND_TOP + GROUND_HEIGHT + GLASS_PARALLAX;

export const GLASS_TOP = GROUND_TOP - GLASS_OVERHANG - BOX_TO_GLASS_TOP;
/** The box may reach a little into the bleed; only transparent pixels do. */
export const GLASS_INSET_X = BLEED + Math.round((VISIBLE_WIDTH - GLASS_BOX_WIDTH) / 2);

/** Where the drink's foot actually lands, which is where the shadow belongs. */
export const GLASS_BASE_Y = GLASS_TOP + BOX_TO_GLASS_BASE;
/** Ground still showing below the foot, so the glass stands rather than balances. */
export const GLASS_FOOTING = GROUND_TOP + GROUND_HEIGHT - GLASS_BASE_Y;

/**
 * The stadium the glass stands on, sized off the *narrowest* drink in the set
 * rather than off the box: a shadow wider than the glass it belongs to reads as
 * a second object.
 */
export const SHADOW_WIDTH = Math.round(GLASS_BOX_WIDTH * 0.44);
export const SHADOW_HEIGHT = 10;
export const SHADOW_INSET_X = GLASS_INSET_X + Math.round((GLASS_BOX_WIDTH - SHADOW_WIDTH) / 2);
/** Centred on the foot, so it reads as contact rather than as a bar beneath it. */
export const SHADOW_BOTTOM = SLOT_HEIGHT - (GLASS_BASE_Y + Math.round(SHADOW_HEIGHT / 2));

export type ScrollRange = { inputRange: [number, number]; outputRange: [number, number] };

/**
 * The scroll window a row is on screen for.
 *
 * `rowY` is the row's top in content space. At the start of the window the
 * row's media centre sits on the bottom edge of the viewport; at the end, on
 * the top edge. Making the window exactly one viewport is what puts the
 * midpoint of every output range at the moment the row is centred — which is
 * the frame the row was composed at, and the frame reduced motion rests on.
 */
export function rowScrollWindow(rowY: number, viewportHeight: number): [number, number] {
  const centre = rowY + SLOT_HEIGHT / 2;
  return [centre - viewportHeight, centre];
}

function range(rowY: number, viewportHeight: number, outputRange: [number, number]): ScrollRange {
  return { inputRange: rowScrollWindow(rowY, viewportHeight), outputRange };
}

/** The glass drifts against the page, so it reads slower than the copy beside it. */
export const glassParallaxRange = (rowY: number, h: number): ScrollRange =>
  range(rowY, h, [GLASS_PARALLAX, -GLASS_PARALLAX]);

/** The ground counter-drifts, which is what separates the two planes at all. */
export const groundParallaxRange = (rowY: number, h: number): ScrollRange =>
  range(rowY, h, [-GROUND_PARALLAX, GROUND_PARALLAX]);

/** The shadow widens as the glass lifts, and fades as it widens. Contact-shadow behaviour. */
export const shadowScaleRange = (rowY: number, h: number): ScrollRange =>
  range(rowY, h, [0.94, 1.06]);

export const shadowOpacityRange = (rowY: number, h: number): ScrollRange =>
  range(rowY, h, [0.48, 0.32]);

/**
 * The frame the row rests on when the guest has asked for less motion.
 *
 * A designed frame, not a disabled animation: it is the composition the row
 * shows when it is centred in the viewport, which is the midpoint of every
 * range above. The naive reading — reduced motion means hold the start value —
 * would park every row in its *entering* pose, glass low and shadow tight,
 * which is the one frame this was never meant to hold.
 */
export const GLASS_FEATURE_REST = {
  glassShift: 0,
  groundShift: 0,
  shadowScaleX: 1,
  shadowOpacity: 0.4,
} as const;
