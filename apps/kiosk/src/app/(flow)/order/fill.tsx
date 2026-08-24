import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';
import { KioskMenuImage } from '@/components/menu-image';
import { CircleTile } from '@/components/circle/circle-tile';
import { packChoicesFor } from '@/data/menu-source';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import TENANT from '@/tenant/brand.json';

/**
 * Filling the box.
 *
 * This is the screen migration 0029 exists for, and the three things it needs
 * are the three `menu_items.modifiers` cannot express:
 *
 *   1. an EXACT count -- "Select 6" stays shut at five, so the primary action
 *      reads how many are left rather than pretending it can continue;
 *   2. a quantity per choice, so six units can be two of one and four of
 *      another. Tapping a filled choice again adds a second of it;
 *   3. a choice list that is this week's lineup, which changes without anyone
 *      editing the pack.
 *
 * The tray is the progress indicator: a guest can see at a glance how much of
 * the box is theirs. The count beside it is plain text on purpose -- a shared
 * value driving a `Text` renders blank on Fabric (AGENTS.md), and this is the
 * one number on the screen that must never be missing.
 */
export default function FillStep() {
  const tokens = useTokens();
  const { goNext } = useFlow();
  const builder = useBuilder();
  const pack = builder.state.item;
  const packSize = pack?.packSize ?? 0;

  if (!pack || packSize <= 0) return null;

  const choices = packChoicesFor(pack);
  const left = builder.packRemaining(packSize);
  const complete = builder.packComplete(packSize);
  const slots = Array.from({ length: packSize }, (_, index) => index);
  const filled = Object.entries(builder.state.fill)
    .flatMap(([id, count]) => Array.from({ length: count }, () => id));

  return (
    <View style={styles.root}>
      <StepHeading
        title={`Choose ${packSize} for your box`}
        hint="Tap one twice for two of it."
      />

      <View style={[styles.tray, { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg }]}>
        {slots.map((slot) => {
          const choiceId = filled[slot];
          const choice = choices.find((item) => item.id === choiceId);
          return (
            <View
              key={slot}
              style={[styles.slot, { borderColor: `${tokens.textMuted}55`, borderRadius: tokens.radius.pill }]}
            >
              {choice ? (
                <KioskMenuImage
                  request={{ imageSlug: choice.id, monogram: TENANT.business?.monogram, label: choice.name }}
                  variant="kioskSlot"
                  alt={choice.name}
                />
              ) : null}
            </View>
          );
        })}
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.left, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}
        >
          {complete ? 'Box full' : `${left} left`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {choices.map((choice, index) => (
          <CircleTile
            key={choice.id}
            index={index}
            label={choice.name}
            variant="kioskChoice"
            // A full box refuses the tap rather than silently swapping one of
            // the guest's earlier choices for it.
            disabled={complete}
            selected={(builder.state.fill[choice.id] ?? 0) > 0}
            request={{ imageSlug: choice.id, monogram: TENANT.business?.monogram, label: choice.name }}
            onPress={() => builder.allocateChoice(choice.id, packSize)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <KioskPressable
          // States what is missing, never what it does.
          label={complete ? 'Continue' : `Choose ${left} more`}
          disabled={!complete}
          onPress={() => goNext()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 32 },
  tray: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, alignSelf: 'center' },
  slot: { width: 96, height: 96, borderWidth: 2, overflow: 'hidden' },
  left: { marginLeft: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 32, justifyContent: 'center', paddingVertical: 20 },
  footer: { alignItems: 'center', paddingBottom: 18 },
});
