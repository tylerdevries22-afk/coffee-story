import { StyleSheet, Text, View } from 'react-native';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';


/** "Jordan Álvarez" -> "JA". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The monogram disc used anywhere a person is shown without a photo.
 * Extracted from the staff workspace kit when that kit moved to the Operator
 * app; the notifications feed still needs it here.
 */
export function Avatar({ name, size = 44, tone = 'soft' }: { name: string; size?: number; tone?: 'soft' | 'gold' }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'gold' ? tokens.accent : tokens.surface,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.34, color: tone === 'gold' ? tokens.textPrimary : tokens.primary }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: tokens.fontBody },
});
