import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/icon';

type TrainingArtworkProps = {
  url?: string;
  alt: string;
  fallback: AppIconName;
  size: number;
  radius: number;
  tintColor: string;
  backgroundColor: string;
};

/** Draws tenant-authored training media without leaving a broken image hole. */
export function TrainingArtwork({
  url,
  alt,
  fallback,
  size,
  radius,
  tintColor,
  backgroundColor,
}: TrainingArtworkProps) {
  const remoteUrl = url?.startsWith('https://') ? url : null;
  const [failure, setFailure] = useState<{ url: string; attempts: number } | null>(null);
  const attempts = failure?.url === remoteUrl ? failure.attempts : 0;
  const frame = { width: size, height: size, borderRadius: radius, backgroundColor };

  if (!remoteUrl || attempts >= 2) {
    return <View style={[styles.fallback, frame]}><AppIcon name={fallback} size={Math.round(size * 0.46)} tintColor={tintColor} /></View>;
  }

  return (
    <Image
      key={`${remoteUrl}:${attempts}`}
      source={{ uri: remoteUrl }}
      alt={alt}
      cachePolicy="disk"
      contentFit="cover"
      onError={() => setFailure((current) => current?.url === remoteUrl
        ? { url: remoteUrl, attempts: current.attempts + 1 }
        : { url: remoteUrl, attempts: 1 })}
      style={frame}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
