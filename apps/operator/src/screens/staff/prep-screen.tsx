import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { DEMO_BAKE_LIST, DEMO_RECIPE_STEPS } from '@/data/prep-demo';
import {
  bakeProgress, multiplierLabel, scaleQuantity, sortBakeList, type BakeBatch,
} from '@/features/prep/bake-list';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

/**
 * The prep station: a bench tablet, read by someone with flour on their hands.
 *
 * Two states, never more. The list of what has to be baked, and one recipe at a
 * time. A baker mid-batch should not be navigating; they should be looking at
 * the step they are on.
 *
 * Nothing here is smaller than 60pt, because the person using it is not
 * looking at their finger.
 */
export function PrepScreen() {
  const [batches, setBatches] = useState<readonly BakeBatch[]>(DEMO_BAKE_LIST);
  const [openId, setOpenId] = useState<string | null>(null);

  const sorted = useMemo(() => sortBakeList(batches), [batches]);
  const progress = useMemo(() => bakeProgress(batches), [batches]);
  const open = sorted.find((batch) => batch.id === openId) ?? null;

  function advance(id: string) {
    setBatches((current) => current.map((batch) => {
      if (batch.id !== id) return batch;
      if (batch.status === 'pending') return { ...batch, status: 'in_progress' };
      if (batch.status === 'in_progress') {
        return { ...batch, status: 'done', producedQty: batch.targetQty };
      }
      return batch;
    }));
  }

  if (open) return <RecipeDetail batch={open} onBack={() => setOpenId(null)} onAdvance={advance} />;

  return (
    <CollapsingScreen title="Today's bake" eyebrow={`${progress.done} of ${progress.total} done`}>
      {sorted.map((batch) => (
        <Pressable
          key={batch.id}
          accessibilityRole="button"
          accessibilityLabel={`${batch.itemName}, ${batch.targetQty} ${batch.yieldUnit}, ${STATUS_LABEL[batch.status]}`}
          onPress={() => setOpenId(batch.id)}
          style={({ pressed }) => [styles.batchRow, pressed && styles.pressed]}
        >
          <Card style={styles.batchCard}>
            <View style={styles.batchCopy}>
              <Text style={styles.batchName}>{batch.itemName}</Text>
              <Body muted>
                {batch.targetQty} {batch.yieldUnit}
                {multiplierLabel(batch.targetQty / Math.max(batch.yieldQty, 1))
                  ? ` · ${multiplierLabel(batch.targetQty / Math.max(batch.yieldQty, 1))} recipe`
                  : ''}
              </Body>
            </View>
            <View style={[styles.statusPill, STATUS_TONE[batch.status]]}>
              <Text style={[styles.statusText, { color: STATUS_TEXT[batch.status] }]}>
                {STATUS_LABEL[batch.status]}
              </Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </CollapsingScreen>
  );
}

function RecipeDetail({
  batch, onBack, onAdvance,
}: {
  batch: BakeBatch;
  onBack: () => void;
  onAdvance: (id: string) => void;
}) {
  const steps = DEMO_RECIPE_STEPS[batch.id] ?? [];
  const multiplier = multiplierLabel(batch.targetQty / Math.max(batch.yieldQty, 1));

  return (
    <CollapsingScreen
      title={batch.itemName}
      eyebrow={`${batch.targetQty} ${batch.yieldUnit}${multiplier ? ` · ${multiplier} recipe` : ''}`}
      onBack={onBack}
    >
      {/* Pinned and not dismissible. Someone else's allergy is not a detail a
          baker should be able to scroll past. */}
      {batch.allergens.length > 0 ? (
        <View style={styles.allergens}>
          <Text style={styles.allergensLabel}>Contains</Text>
          <Text style={styles.allergensList}>{batch.allergens.join(' · ')}</Text>
        </View>
      ) : null}

      <SectionTitle>Steps</SectionTitle>
      <ScrollView contentContainerStyle={styles.steps}>
        {steps.map((step) => {
          const scaled = step.quantity !== undefined
            ? scaleQuantity(step.quantity, batch)
            : null;
          return (
            <Card key={step.n} style={styles.step}>
              <Text style={styles.stepNumber}>{step.n}</Text>
              <View style={styles.stepCopy}>
                <Text style={styles.stepText}>{step.text}</Text>
                {scaled ? (
                  <Text style={styles.stepQuantity}>
                    {scaled.batch} {step.unit}
                    {/* The recipe's own figure stays visible: a scaled number
                        alone cannot be checked against the card on the wall. */}
                    {scaled.multiplier !== 1 ? `  (recipe ${scaled.recipe} ${step.unit})` : ''}
                  </Text>
                ) : null}
                {step.minutes ? <Body muted>{step.minutes} min</Body> : null}
              </View>
            </Card>
          );
        })}
      </ScrollView>

      {batch.status !== 'done' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={batch.status === 'pending' ? 'Start this batch' : 'Mark this batch done'}
          onPress={() => { onAdvance(batch.id); onBack(); }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>
            {batch.status === 'pending' ? 'Start batch' : 'Mark done'}
          </Text>
        </Pressable>
      ) : null}
    </CollapsingScreen>
  );
}

const STATUS_LABEL = {
  pending: 'To bake',
  in_progress: 'In the oven',
  done: 'Done',
  abandoned: 'Abandoned',
} as const;

const STATUS_TONE = {
  pending: { backgroundColor: colors.ink200 },
  in_progress: { backgroundColor: colors.gold50 },
  done: { backgroundColor: colors.successTint },
  abandoned: { backgroundColor: colors.dangerTint },
} as const;

const STATUS_TEXT = {
  pending: colors.ink700,
  in_progress: colors.warning,
  done: colors.success,
  abandoned: colors.danger,
} as const;

const styles = StyleSheet.create({
  batchRow: { marginBottom: spacing.md },
  batchCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 96 },
  batchCopy: { flex: 1, gap: 4 },
  batchName: { color: colors.ink900, fontFamily: fonts.display, fontSize: 26 },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill },
  statusText: { fontFamily: fonts.sansBold, fontSize: 16 },
  allergens: {
    backgroundColor: colors.dangerTint,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
    marginBottom: spacing.md,
  },
  allergensLabel: {
    color: colors.danger, fontFamily: fonts.sansBold, fontSize: 14,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  allergensList: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 22 },
  steps: { gap: spacing.md, paddingBottom: spacing.xl },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNumber: { color: colors.brand600, fontFamily: fonts.display, fontSize: 34, minWidth: 40 },
  stepCopy: { flex: 1, gap: 6 },
  stepText: { color: colors.ink900, fontFamily: fonts.sans, fontSize: 22, lineHeight: 30 },
  stepQuantity: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 22 },
  action: {
    minHeight: 84, borderRadius: radius.pill, backgroundColor: colors.brand700,
    alignItems: 'center', justifyContent: 'center', marginTop: spacing.md,
  },
  actionLabel: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 24 },
  pressed: { opacity: 0.85 },
});
