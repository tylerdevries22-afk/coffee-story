import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card } from '@/components/ui';
import {
  batchScale, fetchPrepBoard, subscribeToPrepBatches, type PrepBoardEntry,
} from '@platform/data';
import { isoDateInTimeZone } from '@platform/domain';

import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import {
  bakeProgress, multiplierLabel, sortBakeList,
} from '@/features/prep/bake-list';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useOperator } from '@/state/operator-store';
import { useTokens as useBrandTokens } from '@platform/ui';

import { RecipeDetail } from './prep-recipe-detail';
import { createStyles } from './prep-styles';

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
  const { location, locationReady } = useOperator();
  const [batches, setBatches] = useState<readonly PrepBoardEntry[]>(() => isDemo ? DEMO_OPERATOR_FIXTURES.prepBatches : []);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) {
      setBatches(DEMO_OPERATOR_FIXTURES.prepBatches);
      return undefined;
    }
    if (!supabase || !locationReady) return undefined;
    const database = supabase;
    let active = true;
    const load = async () => {
      try {
        const serviceDate = isoDateInTimeZone(new Date(), location.timezone);
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
  }, [isDemo, location.id, location.timezone, locationReady]);

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

const STATUS_LABEL = {
  pending: 'To bake',
  in_progress: 'In the oven',
  done: 'Done',
  abandoned: 'Abandoned',
} as const;
