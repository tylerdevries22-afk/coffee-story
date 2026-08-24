import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney, formatPriceDelta, sizeLabelFor, sizePriceCents } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { StepHeading } from '@/components/chrome/step-heading';
import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import * as haptics from '@/lib/haptics';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';

/**
 * Size and options for one drink.
 *
 * Everything here is the domain's: `optionGroupsFor` decides which groups
 * exist, `visibleOptionGroups` hides the ones that do not apply yet (there is
 * no Ice question until a guest asks for it iced), and `missingRequiredGroups`
 * is what holds the primary action shut. None of that logic is restated on this
 * screen -- it was built and tested long before the kiosk existed and simply
 * had no caller.
 */
export default function OptionsStep() {
  const tokens = useTokens();
  const { goNext } = useFlow();
  const builder = useBuilder();
  const item = builder.state.item;

  if (!item) return null;

  const missing = builder.missingGroups;
  const blocked = missing.length > 0;

  return (
    <View style={styles.root}>
      <StepHeading title={item.name} hint={item.description} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {item.sizes.length > 1 ? (
          <View style={styles.group}>
            <Text style={[styles.groupName, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}>
              Size
            </Text>
            <View style={styles.choices}>
              {item.sizes.map((size) => (
                <Choice
                  key={size.slug}
                  label={sizeLabelFor(size.slug)}
                  detail={formatMoney(sizePriceCents(size))}
                  selected={(builder.state.sizeSlug ?? item.sizes[0]?.slug) === size.slug}
                  onPress={() => builder.setSize(size.slug)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {builder.visibleGroups.map((group) => {
          const chosen = builder.state.selection[group.id] ?? [];
          const isMissing = missing.some((entry) => entry.id === group.id);
          return (
            <View key={group.id} style={styles.group}>
              <Text style={[styles.groupName, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}>
                {group.name}
                {group.required ? (
                  <Text style={{ color: isMissing ? tokens.danger : tokens.textMuted, fontSize: tokens.type.md }}>
                    {isMissing ? '  Required' : ''}
                  </Text>
                ) : null}
              </Text>
              <View style={styles.choices}>
                {group.choices.map((choice) => (
                  <Choice
                    key={choice.id}
                    label={choice.name}
                    detail={formatPriceDelta(choice.priceDeltaCents)}
                    selected={chosen.includes(choice.id)}
                    onPress={() => builder.toggle(group.id, choice.id)}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <KioskPressable
          // The action states what is MISSING rather than what it does, so a
          // disabled pill is never a mystery.
          label={blocked ? `Choose ${missing[0]?.name ?? 'an option'}` : 'Continue'}
          trailing={blocked ? undefined : formatMoney(builder.unitPriceCents)}
          disabled={blocked}
          onPress={() => { haptics.tapped(); goNext(); }}
        />
      </View>
    </View>
  );
}

function Choice({
  label, detail, selected, onPress,
}: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      // aria-pressed, not aria-selected: this is a toggle button, not an option
      // in a listbox, and react-native-web drops accessibilityState on Pressable.
      accessibilityState={{ selected }}
      aria-pressed={selected}
      onPress={() => { haptics.tapped(); onPress(); }}
      style={[
        styles.choice,
        {
          borderRadius: tokens.radius.pill,
          borderColor: selected ? tokens.primary : tokens.textMuted,
          backgroundColor: selected ? tokens.primary : tokens.surfaceElevated,
        },
      ]}
    >
      <Text style={{
        color: selected ? tokens.surfaceElevated : tokens.textPrimary,
        fontFamily: tokens.fontBody, fontSize: tokens.type.lg, fontWeight: '600',
      }}>
        {label}
      </Text>
      {detail ? (
        <Text style={{
          color: selected ? tokens.surfaceElevated : tokens.textMuted,
          fontFamily: tokens.fontBody, fontSize: tokens.type.md,
        }}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 32 },
  scroll: { paddingBottom: 32, gap: 28 },
  group: { gap: 14 },
  groupName: {},
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  // 60pt minimum, per docs/FIVE-SURFACES.md.
  choice: { minHeight: 72, paddingHorizontal: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 2 },
  footer: { alignItems: 'center', paddingVertical: 20 },
});
