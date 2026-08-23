/**
 * The one way a menu photograph is drawn.
 *
 * Before this existed, six screens each reached for `expo-image` with their own
 * geometry -- 56/76/64/72 squares, a full-width 260pt hero, a full-width 132pt
 * items card -- and cover-cropped the same 600x682 portrait source into all
 * of them. A drink shown in the bag looked like a different photograph from the
 * same drink in the menu, because it was: a different slice of it.
 *
 * The fix is the contract in `@platform/ui`: menu assets are stored square, and
 * every frame here is square too, so the only thing that changes between
 * surfaces is the display size. `variant` picks the size; nothing else may.
 *
 * This is view-layer on purpose (it touches assets and `expo-image`), which is
 * why it lives beside the screens rather than in `packages/ui` -- the geometry
 * it reads is what lives in the package, and `menu-image.test.ts` covers that.
 */
import { Image } from 'expo-image';
import { StyleSheet, type StyleProp, type ImageStyle } from 'react-native';

import { menuImageFrame, type MenuImageVariant } from '@platform/ui';

import { colors, radius } from '@/theme/tokens';

export function MenuImage({
  source,
  variant,
  alt,
  style,
}: {
  source: number;
  variant: MenuImageVariant;
  /** Empty string when the surrounding row already names the item. */
  alt: string;
  style?: StyleProp<ImageStyle>;
}) {
  const frame = menuImageFrame(variant);
  return (
    <Image
      source={source}
      // `cover` on a square frame with a square master is a no-op crop; it stays
      // as the fit so a not-yet-normalised asset degrades to a centre crop
      // rather than to letterboxing.
      contentFit="cover"
      alt={alt}
      style={[
        styles.base,
        frame.kind === 'fixed'
          ? { width: frame.size, height: frame.size }
          : styles.fill,
        frame.radius !== 'none' && { borderRadius: radius[frame.radius] },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // The placeholder ground shows while the asset decodes.
  base: { backgroundColor: colors.brand100 },
  // Square by aspect rather than by a fixed height, so a full-bleed hero shows
  // the whole master at whatever width the screen gives it.
  fill: { width: '100%', aspectRatio: 1 },
});
