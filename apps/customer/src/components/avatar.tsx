import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

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
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'gold' ? colors.gold400 : colors.brand100,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.34, color: tone === 'gold' ? colors.ink900 : colors.brand700 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansBold },
});
