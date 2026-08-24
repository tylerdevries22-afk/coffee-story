import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import {
  batchScale, fetchPrepBoard, subscribeToPrepBatches, type PrepBoardEntry,
} from '@platform/data';
import { localIsoDate } from '@platform/domain';

import { DEMO_BAKE_LIST } from '@/data/prep-demo';
import {
  bakeProgress, multiplierLabel, recipeSteps, sortBakeList,
} from '@/features/prep/bake-list';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useOperator } from '@/state/operator-store';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const statusTone = {
    pending: { backgroundColor: tokens.secondary },
    in_progress: { backgroundColor: tokens.surface },
    done: { backgroundColor: tokens.surfaceElevated },
    abandoned: { backgroundColor: tokens.surfaceElevated },
  } as const;
  const statusText = {
    pending: tokens.textPrimary,
    in_progress: tokens.warning,
    done: tokens.success,
    abandoned: tokens.danger,
  } as const;
  const { isDemo } = useAuth();
  const { location } = useOperator();
  const [batches, setBatches] = useState<readonly PrepBoardEntry[]>(() => isDemo ? DEMO_BAKE_LIST : []);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) {
      setBatches(DEMO_BAKE_LIST);
      return undefined;
    }
    if (!supabase) return undefined;
    const database = supabase;
    let active = true;
    const serviceDate = localIsoDate(new Date());
    const load = async () => {
      try {
        const rows = await fetchPrepBoard(database, location.id, serviceDate);
        if (active) setBatches(rows);
      } catch {
        // Keep the last good bench list; the heartbeat retries.
      }
    };
    void load();
    const unsubscribe = subscribeToPrepBatches(database, location.id, () => void load());
    const heartbeat = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(heartbeat);
    };
  }, [isDemo, location.id]);

  const sorted = useMemo(() => sortBakeList(batches), [batches]);
  const progress = useMemo(() => bakeProgress(batches), [batches]);
  const open = sorted.find((batch) => batch.id === openId) ?? null;

  function advance(id: string) {
    const current = batches.find((batch) => batch.id === id);
    if (!current) return;
    const nextStatus = current.status === 'pending'
      ? 'in_progress'
      : current.status === 'in_progress' ? 'done' : current.status;
    setBatches((current) => current.map((batch) => {
      if (batch.id !== id) return batch;
      if (batch.status === 'pending') return { ...batch, status: 'in_progress' };
      if (batch.status === 'in_progress') {
        return { ...batch, status: 'done', produced_qty: batch.target_qty };
      }
      return batch;
    }));
    if (!isDemo && supabase && nextStatus !== current.status) {
      const completed = nextStatus === 'done';
      void supabase
        .from('prep_batches')
        .update({
          status: nextStatus,
          ...(nextStatus === 'in_progress' ? { started_at: new Date().toISOString() } : {}),
          ...(completed ? {
            completed_at: new Date().toISOString(),
            produced_qty: current.target_qty,
          } : {}),
        })
        .eq('id', id)
        .then((result) => {
          if (result.error) {
            setBatches((rows) => rows.map((batch) => batch.id === id ? current : batch));
          }
        });
    }
  }

  if (open) return <RecipeDetail batch={open} onBack={() => setOpenId(null)} onAdvance={advance} />;

  return (
    <CollapsingScreen title="Today's bake" eyebrow={`${progress.done} of ${progress.total} done`}>
      {sorted.map((batch) => (
        <Pressable
          key={batch.id}
          accessibilityRole="button"
          accessibilityLabel={`${batch.itemName}, ${batch.target_qty} ${batch.recipe.yield_unit}, ${STATUS_LABEL[batch.status]}`}
          onPress={() => setOpenId(batch.id)}
          style={({ pressed }) => [styles.batchRow, pressed && styles.pressed]}
        >
          <Card style={styles.batchCard}>
            <View style={styles.batchCopy}>
              <Text style={styles.batchName}>{batch.itemName}</Text>
              <Body muted>
                {batch.target_qty} {batch.recipe.yield_unit}
                {multiplierLabel(batchScale(batch.recipe, batch.target_qty))
                  ? ` · ${multiplierLabel(batchScale(batch.recipe, batch.target_qty))} recipe`
                  : ''}
              </Body>
            </View>
            <View style={[styles.statusPill, statusTone[batch.status]]}>
              <Text style={[styles.statusText, { color: statusText[batch.status] }]}>
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
  batch: PrepBoardEntry;
  onBack: () => void;
  onAdvance: (id: string) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const steps = recipeSteps(batch.recipe.steps);
  const scale = batchScale(batch.recipe, batch.target_qty);
  const multiplier = multiplierLabel(scale);

  return (
    <CollapsingScreen
      title={batch.itemName}
      eyebrow={`${batch.target_qty} ${batch.recipe.yield_unit}${multiplier ? ` · ${multiplier} recipe` : ''}`}
      onBack={onBack}
    >
      {/* Pinned and not dismissible. Someone else's allergy is not a detail a
          baker should be able to scroll past. */}
      {batch.recipe.allergens.length > 0 ? (
        <View style={styles.allergens}>
          <Text style={styles.allergensLabel}>Contains</Text>
          <Text style={styles.allergensList}>{batch.recipe.allergens.join(' · ')}</Text>
        </View>
      ) : null}

      <SectionTitle>Steps</SectionTitle>
      <ScrollView contentContainerStyle={styles.steps}>
        {steps.map((step) => {
          const scaled = step.quantity !== undefined
            ? Math.round(step.quantity * scale * 100) / 100
            : null;
          return (
            <Card key={step.n} style={styles.step}>
              <Text style={styles.stepNumber}>{step.n}</Text>
              <View style={styles.stepCopy}>
                <Text style={styles.stepText}>{step.text}</Text>
                {scaled ? (
                  <Text style={styles.stepQuantity}>
                    {scaled} {step.unit}
                    {/* The recipe's own figure stays visible: a scaled number
                        alone cannot be checked against the card on the wall. */}
                    {scale !== 1 ? `  (recipe ${step.quantity} ${step.unit})` : ''}
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

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  batchRow: { marginBottom: tokens.spacing.lg },
  batchCard: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, minHeight: 96 },
  batchCopy: { flex: 1, gap: 4 },
  batchName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 26 },
  statusPill: { paddingHorizontal: tokens.spacing.lg, paddingVertical: 10, borderRadius: tokens.radius.pill },
  statusText: { fontFamily: tokens.fontBody, fontSize: 16 },
  allergens: {
    backgroundColor: tokens.surfaceElevated,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    gap: 4,
    marginBottom: tokens.spacing.lg,
  },
  allergensLabel: {
    color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 14,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  allergensList: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22 },
  steps: { gap: tokens.spacing.lg, paddingBottom: tokens.spacing.xxl },
  step: { flexDirection: 'row', gap: tokens.spacing.lg, alignItems: 'flex-start' },
  stepNumber: { color: tokens.primary, fontFamily: tokens.fontDisplay, fontSize: 34, minWidth: 40 },
  stepCopy: { flex: 1, gap: 6 },
  stepText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22, lineHeight: 30 },
  stepQuantity: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22 },
  action: {
    minHeight: 84, borderRadius: tokens.radius.pill, backgroundColor: tokens.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: tokens.spacing.lg,
  },
  actionLabel: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 24 },
  pressed: { opacity: 0.85 },
});
