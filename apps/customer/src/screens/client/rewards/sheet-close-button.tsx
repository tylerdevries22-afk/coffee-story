import { Pressable } from 'react-native';

import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { useRewardStyles } from './styles';

export function CloseButton({ onPress }: { onPress: () => void }) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
    >
      <AppIcon name="xmark" size={25} tintColor={tokens.textPrimary} weight="medium" />
    </Pressable>
  );
}
