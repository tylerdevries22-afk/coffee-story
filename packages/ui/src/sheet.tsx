/** Bottom sheet + the modifier picker that rides in it. */
import { useEffect, useRef, type PropsWithChildren } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { withAlpha } from './components';
import { useTokens } from './theme';

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: PropsWithChildren<{ visible: boolean; onClose: () => void; title?: string }>) {
  const tokens = useTokens();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? tokens.motion.base : tokens.motion.fast,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide, tokens.motion.base, tokens.motion.fast, visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: withAlpha(tokens.textPrimary, 0.4) }}
      />
      <Animated.View
        style={{
          maxHeight: '85%',
          backgroundColor: tokens.surface,
          borderTopLeftRadius: tokens.radius.lg,
          borderTopRightRadius: tokens.radius.lg,
          paddingBottom: tokens.spacing.xl,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }],
          opacity: slide,
        }}
      >
        <View style={{ alignItems: 'center', paddingVertical: tokens.spacing.sm }}>
          <View style={{ width: 36, height: 4, borderRadius: tokens.radius.pill, backgroundColor: withAlpha(tokens.textMuted, 0.35) }} />
        </View>
        {title ? (
          <Text style={{ fontFamily: tokens.fontDisplay, fontSize: 20, color: tokens.textPrimary, paddingHorizontal: tokens.spacing.lg, paddingBottom: tokens.spacing.sm }}>
            {title}
          </Text>
        ) : null}
        <ScrollView contentContainerStyle={{ paddingHorizontal: tokens.spacing.lg, gap: tokens.spacing.lg }}>
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** The modifiers JSONB shape from packages/schema, as the picker renders it. */
export type ModifierChoice = { id: string; label: string; price_cents?: number };
export type ModifierGroup = {
  id: string;
  name: string;
  select: 'single' | 'multi';
  required?: boolean;
  maxChoices?: number;
  choices: readonly ModifierChoice[];
};

export function ModifierSheet({
  visible,
  onClose,
  title,
  groups,
  selection,
  onToggle,
  formatPrice,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  groups: readonly ModifierGroup[];
  /** groupId -> chosen choice ids. */
  selection: Record<string, readonly string[]>;
  onToggle: (groupId: string, choiceId: string) => void;
  /** Integer cents -> display, injected so money formatting stays in one place. */
  formatPrice: (cents: number) => string;
  footer?: React.ReactNode;
}) {
  const tokens = useTokens();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {groups.map((group) => (
        <View key={group.id} style={{ gap: tokens.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: tokens.spacing.sm }}>
            <Text style={{ fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 15, color: tokens.textPrimary }}>
              {group.name}
            </Text>
            <Text style={{ fontFamily: tokens.fontBody, fontSize: 12, color: tokens.textMuted }}>
              {group.required ? 'Required' : group.select === 'multi' && group.maxChoices ? `Choose up to ${group.maxChoices}` : 'Optional'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm }}>
            {group.choices.map((choice) => {
              const selected = (selection[group.id] ?? []).includes(choice.id);
              const priced = choice.price_cents ? ` +${formatPrice(choice.price_cents)}` : '';
              return (
                <Pressable
                  key={choice.id}
                  accessibilityRole={group.select === 'single' ? 'radio' : 'checkbox'}
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${choice.label}${priced}`}
                  onPress={() => onToggle(group.id, choice.id)}
                  style={({ pressed }) => ({
                    paddingHorizontal: tokens.spacing.md,
                    paddingVertical: tokens.spacing.sm,
                    borderRadius: tokens.radius.pill,
                    borderWidth: 1,
                    borderColor: selected ? tokens.primary : withAlpha(tokens.textMuted, 0.4),
                    backgroundColor: selected ? tokens.primary : tokens.surfaceElevated,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ fontFamily: tokens.fontBody, fontSize: 14, color: selected ? tokens.surfaceElevated : tokens.textPrimary }}>
                    {choice.label}{priced}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {footer}
    </Sheet>
  );
}
