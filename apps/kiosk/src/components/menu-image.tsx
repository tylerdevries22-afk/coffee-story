import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { menuImageFrame, useTokens, type MenuImageVariant } from '@platform/ui';

import { resolveImage, type BundledArt, type ImageRequest } from '@/imagery/resolve-image';

/**
 * The one way a menu photograph is drawn on the kiosk.
 *
 * Same contract as the customer app's: it takes a `variant`, never a size, so
 * the geometry lives in `@platform/ui` and the only thing that changes between
 * surfaces is how big the square is. What is different here is the source --
 * the kiosk resolves a remote url first and degrades to a token-drawn
 * monogram, because it deliberately does not bundle the menu.
 *
 * View-layer on purpose (it touches `expo-image`), which is why it sits beside
 * the screens rather than in the package.
 */
export function KioskMenuImage({
  request,
  variant,
  bundled = {},
  alt,
}: {
  request: ImageRequest;
  variant: MenuImageVariant;
  bundled?: BundledArt;
  /** Empty when the surrounding tile already names the item. */
  alt: string;
}) {
  const tokens = useTokens();
  const frame = menuImageFrame(variant);
  const size = frame.kind === 'fixed' ? frame.size : undefined;
  const radius = frame.radius === 'circle'
    ? (size ?? 0) / 2
    : frame.radius === 'none' ? 0 : tokens.radius[frame.radius];
  const box = frame.kind === 'fixed'
    ? { width: frame.size, height: frame.size }
    : styles.fill;

  const resolved = resolveImage(request, bundled);

  if (resolved.kind === 'monogram') {
    return (
      <View
        accessible={alt.length > 0}
        accessibilityRole="image"
        accessibilityLabel={alt || undefined}
        style={[box, { borderRadius: radius, backgroundColor: tokens.secondary }, styles.monogram]}
      >
        <Text
          style={{
            color: tokens.surfaceElevated,
            fontFamily: tokens.fontDisplay,
            fontSize: Math.round((size ?? tokens.type.hero) * 0.3),
          }}
        >
          {resolved.initials}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={resolved.kind === 'remote' ? { uri: resolved.uri } : resolved.source}
      // A shop network is not a data centre. Disk caching is what stops the
      // first screen showing holes every time the kiosk returns to attract.
      cachePolicy="disk"
      contentFit="cover"
      alt={alt}
      style={[box, { borderRadius: radius, backgroundColor: tokens.secondary }]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', aspectRatio: 1 },
  monogram: { alignItems: 'center', justifyContent: 'center' },
});
