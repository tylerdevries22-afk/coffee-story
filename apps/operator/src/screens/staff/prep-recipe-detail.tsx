import { Pressable, ScrollView, Text, View } from 'react-native';

import { batchScale, type PrepBoardEntry } from '@platform/data';
import { useTokens as useBrandTokens } from '@platform/ui';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { multiplierLabel, recipeSteps } from '@/features/prep/bake-list';

import { createStyles } from './prep-styles';

export function RecipeDetail({
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
