import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { nextPackChoiceBoundary, packChoicesOf } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { FlowRecovery } from '@/components/chrome/flow-recovery';
import { StepHeading } from '@/components/chrome/step-heading';
import { KioskMenuImage } from '@/components/menu-image';
import { CircleTile } from '@/components/circle/circle-tile';
import { useKioskMenu } from '@/data/menu-store';
import { isComplete, remaining, retainAllowedChoices } from '@/features/pack-fill';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import { TENANT } from '@/tenant';

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
  const { goNext, goTo } = useFlow();
  const builder = useBuilder();
  const { menu } = useKioskMenu();
  const pack = builder.state.item;
  const { retainPackChoices } = builder;
  const packSize = pack?.packSize ?? 0;
  const [choiceClock, setChoiceClock] = useState(Date.now());
  const choices = useMemo(
    () => (pack && packSize > 0 ? packChoicesOf(menu, pack, choiceClock) : []),
    [menu, pack, packSize, choiceClock],
  );
  const allowedChoiceIds = useMemo(() => choices.map((choice) => choice.id), [choices]);

  useEffect(() => {
    if (!pack || packSize <= 0) goTo('entry');
  }, [pack, packSize, goTo]);
  useEffect(() => {
    retainPackChoices(allowedChoiceIds);
  }, [allowedChoiceIds, retainPackChoices]);
  useEffect(() => {
    if (!pack) return undefined;
    const boundary = nextPackChoiceBoundary(menu, pack, choiceClock);
    if (boundary === null) return undefined;
    const delay = Math.min(2_147_000_000, Math.max(0, boundary - Date.now() + 25));
    const timer = setTimeout(() => setChoiceClock(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [choiceClock, menu, pack]);

  if (!pack || packSize <= 0) return <FlowRecovery onRecover={() => goTo('entry')} />;

  const validFill = retainAllowedChoices(builder.state.fill, allowedChoiceIds);
  const left = remaining({ packSize }, validFill);
  const complete = isComplete({ packSize }, validFill);
  const slots = Array.from({ length: packSize }, (_, index) => index);
  const filled = Object.entries(validFill)
    .flatMap(([id, count]) => Array.from({ length: count }, () => id));

  function continueWithCurrentLineup() {
    if (!pack) return;
    const currentIds = packChoicesOf(menu, pack, Date.now()).map((choice) => choice.id);
    const currentFill = retainAllowedChoices(builder.state.fill, currentIds);
    retainPackChoices(currentIds);
    if (isComplete({ packSize }, currentFill)) goNext();
  }

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
            <Pressable
              key={slot}
              accessibilityLabel={choiceId ? `Remove one ${choice?.name ?? choiceId} from the box` : `Empty box slot ${slot + 1}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: !choiceId }}
              disabled={!choiceId}
              onPress={() => {
                if (choiceId) builder.releaseChoice(choiceId);
              }}
              style={[styles.slot, { borderColor: `${tokens.textMuted}55`, borderRadius: tokens.radius.pill }]}
            >
              {choice ? (
                <KioskMenuImage
                  request={{
                    imageSlug: choice.id,
                    imageUrl: choice.imageUrl,
                    monogram: TENANT.business?.monogram,
                    label: choice.name,
                  }}
                  variant="kioskSlot"
                  alt=""
                />
              ) : null}
              {choiceId ? (
                <View style={[styles.removeBadge, { backgroundColor: tokens.primary }]}>
                  <Text style={[styles.removeLabel, { color: tokens.surfaceElevated, fontFamily: tokens.fontBody }]}>Remove</Text>
                </View>
              ) : null}
            </Pressable>
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
            caption={(validFill[choice.id] ?? 0) > 0
              ? `${validFill[choice.id]} in box`
              : undefined}
            variant="kioskChoice"
            // A full box refuses the tap rather than silently swapping one of
            // the guest's earlier choices for it.
            disabled={complete}
            selected={(validFill[choice.id] ?? 0) > 0}
            request={{
              imageSlug: choice.id,
              imageUrl: choice.imageUrl,
              monogram: TENANT.business?.monogram,
              label: choice.name,
            }}
            onPress={() => builder.allocateChoice(choice.id, packSize)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <KioskPressable
          // States what is missing, never what it does.
          label={complete ? 'Continue' : `Choose ${left} more`}
          disabled={!complete}
          onPress={continueWithCurrentLineup}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 32 },
  tray: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
    gap: 14, padding: 18, alignSelf: 'center', maxWidth: '100%',
  },
  slot: { width: 96, height: 96, borderWidth: 2, overflow: 'hidden' },
  removeBadge: { position: 'absolute', left: 8, right: 8, bottom: 6, borderRadius: 999, paddingVertical: 3 },
  removeLabel: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  left: { marginLeft: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 32, justifyContent: 'center', paddingVertical: 20 },
  footer: { alignItems: 'center', paddingBottom: 18 },
});
