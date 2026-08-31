import { previewTargets, type PreviewSurface } from '@platform/domain';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens } from './theme';

type Props = { currentSlug: string; directory: string | undefined; surface: PreviewSurface };

/** Public preview navigation only; this never changes an authenticated tenant context. */
export function PreviewSwitcher({ currentSlug, directory, surface }: Props) {
  const tokens = useTokens();
  const targets = previewTargets(directory, surface, currentSlug);
  if (Platform.OS !== 'web' || targets.length < 2) return null;
  return (
    <View style={[styles.shell, { backgroundColor: tokens.surfaceElevated, borderColor: tokens.textMuted }]}>
      <Text style={[styles.label, { color: tokens.textMuted, fontFamily: tokens.fontBody }]}>Preview tenant</Text>
      <View style={styles.targets}>
        {targets.map((target) => (
          <Pressable
            accessibilityRole="link"
            disabled={target.current}
            key={target.slug}
            onPress={() => void Linking.openURL(target.url)}
            style={[styles.target, target.current && { backgroundColor: tokens.primary }]}
          >
            <Text style={{ color: target.current ? tokens.surfaceElevated : tokens.textPrimary, fontFamily: tokens.fontBody }}>
              {target.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute', right: 16, top: 16, zIndex: 1000, borderWidth: 1,
    borderRadius: 12, padding: 10, gap: 6, maxWidth: 320,
  },
  label: { fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  target: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
});
