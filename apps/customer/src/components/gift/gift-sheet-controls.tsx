import { Pressable } from 'react-native';

import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { createGiftStyles } from './gift-shelves.styles';

export function CloseButton({ onPress, label }: { onPress: () => void; label: string }) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
    >
      <AppIcon name="xmark" size={17} tintColor={tokens.textPrimary} />
    </Pressable>
  );
}
