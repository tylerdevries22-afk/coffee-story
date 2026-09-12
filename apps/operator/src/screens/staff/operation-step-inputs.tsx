import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { OperationIntentIssue, OperationIntentResponse } from '@platform/offline';
import { choiceState, useTokens } from '@platform/ui';

import type { OperatorChecklistStep } from '@/features/operations/model';

import { createStyles } from './operation-detail-styles';

type Styles = ReturnType<typeof createStyles>;

export function StepResponse({ onChange, response, step, styles }: {
  onChange: (value: OperationIntentResponse | undefined) => void; response?: OperationIntentResponse;
  step: OperatorChecklistStep; styles: Styles;
}) {
  const tokens = useTokens();
  const notApplicable = typeof response === 'object' && response.state === 'not_applicable'
    ? response : null;
  const notApplicableControl = step.allowNotApplicable ? <>
    <Choice label="Not applicable" onPress={() => onChange({ state: 'not_applicable', reason: '' })}
      selected={notApplicable !== null} styles={styles} />
    {notApplicable ? <TextInput accessibilityLabel={`Reason ${step.title} is not applicable`}
      maxLength={500} onChangeText={(reason) => onChange({ state: 'not_applicable', reason })}
      placeholder="Reason this step does not apply" placeholderTextColor={tokens.textMuted}
      style={styles.input} value={notApplicable.reason} /> : null}
  </> : null;
  if (step.responseKind === 'confirm') {
    return <View style={styles.responseGroup}><Choice label="Confirmed" onPress={() => onChange(true)}
      selected={response === true} styles={styles} />{notApplicableControl}</View>;
  }
  if (step.responseKind === 'pass_fail') {
    return <View style={styles.responseGroup}><View style={styles.choices}><Choice label="Pass" onPress={() => onChange(true)} selected={response === true}
      styles={styles} /><Choice label="Needs attention" onPress={() => onChange(false)} selected={response === false}
      styles={styles} /></View>{notApplicableControl}</View>;
  }
  return <View style={styles.responseGroup}><TextInput accessibilityLabel={step.title} keyboardType={step.responseKind === 'number' ? 'decimal-pad' : 'default'}
    maxLength={step.maxLength} multiline={step.responseKind === 'text'} onChangeText={(value) => {
      if (step.responseKind === 'text') onChange(value);
      else if (!value.trim()) onChange(undefined);
      else if (Number.isFinite(Number(value))) onChange(Number(value));
    }} placeholder={step.responseKind === 'number' ? 'Enter value' : 'Enter response'}
    placeholderTextColor={tokens.textMuted} style={styles.input}
    value={response === undefined || typeof response === 'object' ? '' : String(response)} />{notApplicableControl}</View>;
}

function Choice({ label, onPress, selected, styles }: {
  label: string; onPress: () => void; selected: boolean; styles: Styles;
}) {
  return <Pressable accessibilityRole="radio" {...choiceState(selected)} onPress={onPress}
    style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}>
    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
  </Pressable>;
}

export function IssueFields({ categories, issue, onChange, stepKey, styles }: {
  categories: readonly string[]; issue?: OperationIntentIssue; onChange: (issue: OperationIntentIssue) => void;
  stepKey: string; styles: Styles;
}) {
  const tokens = useTokens();
  const category = issue?.category ?? categories[0] ?? 'other';
  const next = (changes: Partial<OperationIntentIssue>) => onChange({ category, severity: 'normal',
    description: '', stepKey, ...issue, ...changes });
  return (
    <View style={styles.issue}>
      <Text style={styles.issueTitle}>Issue details required</Text>
      {categories.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}>{categories.map((item) => <Choice key={item} label={item}
          onPress={() => next({ category: item })} selected={category === item} styles={styles} />)}</ScrollView> : null}
      <TextInput accessibilityLabel={`Issue description for ${stepKey}`} maxLength={2_000} multiline
        onChangeText={(description) => next({ description })} placeholder="Describe what needs attention"
        placeholderTextColor={tokens.textMuted} style={[styles.input, styles.note]}
        value={issue?.description ?? ''} />
    </View>
  );
}
