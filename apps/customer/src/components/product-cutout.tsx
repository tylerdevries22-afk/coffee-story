/**
 * The one way a product cut-out is drawn.
 *
 * `MenuImage` cannot be reused for this, for three independent reasons:
 *
 *   - it paints `colors.brand100` behind every pixel. On a cut-out that cream
 *     rectangle *is* the background the whole exercise removed;
 *   - it fits `cover`, which fills by cropping. A tall glass loses its rim;
 *   - every one of its frames is square, so a 3:4 subject in a 56pt frame is a
 *     42pt glass with 7pt of dead air either side.
 *
 * Split the same way `menu-image.ts` / `menu-image.tsx` are: the geometry and
 * the grade doctrine live in `@platform/ui` where `node:test` reaches them,
 * and this file is the view layer because it touches assets and `expo-image`.
 *
 * `source` is a union rather than a Metro module id, so a tenant serving its
 * media from `menu_items.image_url` needs no change here. `MenuImage.source`
 * deliberately stays `number`: widening it would let a remote URL into all six
 * square photograph sites, every one of which paints a ground behind it.
 */
import { Image } from 'expo-image';
import { StyleSheet, type ImageStyle, type StyleProp } from 'react-native';

import { PRODUCT_CUTOUT_SPEC, productCutoutFrame, type ProductCutoutVariant } from '@platform/ui';
import { type ProductMediaRef } from '@platform/domain';

import { BUNDLED_CUTOUTS } from '@/tenant/product-media';

export type ProductCutoutSource = number | { uri: string };

/**
 * The last mile the resolver deliberately does not do.
 *
 * `resolveProductMedia` returns a reference so it can stay framework-free and
 * testable; turning that reference into something `expo-image` accepts is the
 * one step that has to know about Metro, and so is the one step that lives here.
 */
export function productCutoutSource(ref: ProductMediaRef): ProductCutoutSource | null {
  if (ref.kind === 'remote') return { uri: ref.url };
  return BUNDLED_CUTOUTS[ref.slug] ?? null;
}

export function ProductCutout({
  source,
  variant,
  alt,
  style,
}: {
  source: ProductCutoutSource;
  variant: ProductCutoutVariant;
  /** Empty string when the surrounding row already names the drink. */
  alt: string;
  style?: StyleProp<ImageStyle>;
}) {
  const frame = productCutoutFrame(variant);
  return (
    <Image
      source={source}
      // `contain` even though the frame matches the master's aspect: a
      // not-yet-seated asset should degrade to letterboxing rather than to a
      // crop, because a cropped glass is a broken glass.
      contentFit="contain"
      alt={alt}
      style={[
        frame.kind === 'fixed' ? { width: frame.width, height: frame.height } : styles.fill,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // No `backgroundColor` anywhere in this file. A placeholder ground would
  // flash a rectangle exactly where there is meant to be nothing, and would
  // then sit behind the glass for the rest of the session.
  //
  // Portrait by aspect rather than by a fixed height, so a fill-variant cut-out
  // shows the whole master at whatever width the screen gives it -- and reads
  // the master's own ratio rather than a second copy of it.
  fill: { width: '100%', aspectRatio: PRODUCT_CUTOUT_SPEC.aspect },
});
