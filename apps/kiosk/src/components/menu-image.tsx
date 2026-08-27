import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { menuImageFrame, useTokens, type MenuImageVariant } from '@platform/ui';

import { resolveImage, type BundledArt, type ImageRequest } from '@/imagery/resolve-image';
import { TENANT_MENU_MEDIA } from '@/tenant/menu-media';

/**
 * The one way a menu photograph is drawn on the kiosk.
 *
 * Same contract as the customer app's: the variant owns the baseline geometry
 * in `@platform/ui`, while the shared constellation may provide a responsive
 * diameter for a compact kiosk stage. The generated tenant bundle wins for
 * known slugs, while live-only rows can use a remote URL and degrade to the
 * token-drawn monogram after one retry.
 *
 * View-layer on purpose (it touches `expo-image`), which is why it sits beside
 * the screens rather than in the package.
 */
export function KioskMenuImage({
  request,
  variant,
  bundled = TENANT_MENU_MEDIA,
  alt,
  size: sizeOverride,
}: {
  request: ImageRequest;
  variant: MenuImageVariant;
  bundled?: BundledArt;
  /** Empty when the surrounding tile already names the item. */
  alt: string;
  /** Responsive diameter supplied by the shared kiosk constellation layout. */
  size?: number;
}) {
  const tokens = useTokens();
  const [remoteFailure, setRemoteFailure] = useState<{ uri: string; attempts: number } | null>(null);
  const frame = menuImageFrame(variant);
  const size = sizeOverride ?? (frame.kind === 'fixed' ? frame.size : undefined);
  const radius = frame.radius === 'circle'
    ? (size ?? 0) / 2
    : frame.radius === 'none' ? 0 : tokens.radius[frame.radius];
  const box = frame.kind === 'fixed' || sizeOverride !== undefined
    ? { width: size, height: size }
    : styles.fill;

  const remoteAttempts = remoteFailure !== null && remoteFailure.uri === request.imageUrl
    ? remoteFailure.attempts
    : 0;
  const failedRemoteUri = remoteAttempts >= 2 && typeof request.imageUrl === 'string'
    ? request.imageUrl
    : null;
  const resolved = resolveImage(request, bundled, failedRemoteUri);

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
      key={resolved.kind === 'remote' ? `${resolved.uri}:${remoteAttempts}` : undefined}
      source={resolved.kind === 'remote' ? { uri: resolved.uri } : resolved.source}
      // A shop network is not a data centre. Disk caching is what stops the
      // first screen showing holes every time the kiosk returns to attract.
      cachePolicy="disk"
      contentFit="cover"
      alt={alt}
      onError={resolved.kind === 'remote' ? () => {
        setRemoteFailure((current) => current?.uri === resolved.uri
          ? { uri: resolved.uri, attempts: current.attempts + 1 }
          : { uri: resolved.uri, attempts: 1 });
      } : undefined}
      style={[box, { borderRadius: radius, backgroundColor: tokens.secondary }]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', aspectRatio: 1 },
  monogram: { alignItems: 'center', justifyContent: 'center' },
});
