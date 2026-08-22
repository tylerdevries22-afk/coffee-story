import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { BUSINESS_MONOGRAM } from '@/data/business';
import { colors, fonts, shadow } from '@/theme/tokens';

type ProfileAvatarProps = {
  name: string;
  avatarUrl: string | null;
  size?: number;
  editable?: boolean;
  onEdit?: () => void;
};

/** Shared avatar treatment used by every client, staff, and owner profile surface. */
export function ProfileAvatar({
  name,
  avatarUrl,
  size = 48,
  editable = false,
  onEdit,
}: ProfileAvatarProps) {
  const avatar = avatarUrl ? (
    <Image
      accessibilityLabel={`${name} profile photo`}
      alt={`${name} profile photo`}
      contentFit="cover"
      source={{ uri: avatarUrl }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  ) : (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: Math.max(15, size * 0.34) }]}>{initials(name)}</Text>
    </View>
  );

  return (
    <View style={{ width: size, height: size }}>
      {avatar}
      {editable && onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name} profile photo`}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          style={({ pressed }) => [
            styles.edit,
            { right: size < 72 ? -5 : 1, bottom: size < 72 ? -5 : 1 },
            pressed && styles.pressed,
          ]}
        >
          <AppIcon name="camera.fill" size={size < 72 ? 12 : 16} tintColor={colors.white} />
        </Pressable>
      ) : null}
    </View>
  );
}

function initials(name: string): string {
  const pieces = name.trim().split(/\s+/).filter(Boolean);
  return pieces.slice(0, 2).map((piece) => piece[0]?.toUpperCase() ?? '').join('') || BUSINESS_MONOGRAM;
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold400 },
  initials: { color: colors.ink900, fontFamily: fonts.display },
  edit: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.brand700,
    ...shadow.card,
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.94 }] },
});
