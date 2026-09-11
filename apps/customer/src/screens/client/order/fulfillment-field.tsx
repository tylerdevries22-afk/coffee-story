import { Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './fulfillment-step-styles';

export function Field({ label, containerStyle, onClear, ...props }: TextInputProps & {
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Renders the clear button. Omit when there is nothing to clear. */
  onClear?: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View>
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={tokens.textMuted}
          style={[styles.input, props.multiline && styles.multiline, onClear && styles.inputClearable]}
        />
        {onClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            hitSlop={8}
            onPress={onClear}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <AppIcon name="xmark.circle.fill" size={20} tintColor={tokens.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
