import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatMoney, formatPriceDelta, type OptionChoice, type OptionGroup, type OptionSelection } from '@platform/domain';

import { choiceState, disabledState } from './a11y-state';
import { useTokens } from './theme';

export type SizeOption = { slug: string; label: string; priceCents: number };

export function SizeSegmented({ sizes, value, onChange }: { sizes: readonly SizeOption[]; value: string; onChange: (slug: string) => void }) {
  const tokens = useTokens();
  if (sizes.length < 2) return null;
  return <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: tokens.spacing.xs, padding: tokens.spacing.xs, borderRadius: tokens.radius.pill, backgroundColor: tokens.surface }}>
    {sizes.map((size) => { const selected = size.slug === value; return <Pressable key={size.slug} accessibilityRole="radio" accessibilityLabel={`${size.label}, ${formatMoney(size.priceCents)}`} {...choiceState(selected)} onPress={() => onChange(size.slug)} style={({ pressed }) => ({ flex: 1, minHeight: 56, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: tokens.spacing.xs, backgroundColor: selected ? tokens.surfaceElevated : 'transparent', opacity: pressed ? 0.72 : 1 })}>
      <Text style={{ color: selected ? tokens.textPrimary : tokens.textMuted, fontFamily: tokens.fontBody, fontWeight: selected ? '700' : '500', fontSize: tokens.type.sm }}>{size.label}</Text>
      <Text style={{ color: selected ? tokens.primary : tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xs }}>{formatMoney(size.priceCents)}</Text>
    </Pressable>; })}
  </View>;
}

export function OptionGroupField({ group, selection, onToggle }: { group: OptionGroup; selection: OptionSelection; onToggle: (groupId: string, choiceId: string) => void }) {
  const tokens = useTokens();
  const chosen = selection[group.id] ?? [];
  const atLimit = group.select === 'multi' && chosen.length >= group.maxChoices;
  return <View style={{ gap: tokens.spacing.sm }}><View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: tokens.spacing.sm }}><Text style={{ color: tokens.textPrimary, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.lg }}>{group.name}</Text><Text style={{ color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xs }}>{group.required ? 'Required' : group.select === 'multi' ? `Optional · choose up to ${group.maxChoices}` : 'Optional'}</Text></View>
    <View accessibilityRole={group.select === 'single' ? 'radiogroup' : undefined} style={{ borderRadius: tokens.radius.md, overflow: 'hidden', backgroundColor: tokens.surfaceElevated }}>{group.choices.map((choice) => <OptionRow key={choice.id} choice={choice} select={group.select} checked={chosen.includes(choice.id)} disabled={atLimit && !chosen.includes(choice.id)} onPress={() => onToggle(group.id, choice.id)} />)}</View>
  </View>;
}

function OptionRow({ choice, select, checked, disabled, onPress }: { choice: OptionChoice; select: OptionGroup['select']; checked: boolean; disabled: boolean; onPress: () => void }) {
  const tokens = useTokens();
  const delta = formatPriceDelta(choice.priceDeltaCents);
  return <Pressable accessibilityRole={select === 'single' ? 'radio' : 'checkbox'} accessibilityLabel={delta ? `${choice.name}, ${delta.replace('+', 'plus ')}` : choice.name} {...choiceState(checked)} {...disabledState(disabled)} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, paddingHorizontal: tokens.spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.secondary, opacity: disabled ? 0.42 : pressed ? 0.72 : 1 })}>
    <View style={{ width: 22, height: 22, borderRadius: select === 'single' ? tokens.radius.pill : tokens.radius.sm, borderWidth: checked ? (select === 'single' ? 7 : 2) : 2, borderColor: checked ? tokens.primary : tokens.textMuted, backgroundColor: checked && select !== 'single' ? tokens.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{checked && select !== 'single' ? <Text style={{ color: tokens.surfaceElevated, fontWeight: '700' }}>✓</Text> : null}</View>
    <Text style={{ flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontWeight: checked ? '600' : '400', fontSize: tokens.type.md }}>{choice.name}</Text>{delta ? <Text style={{ color: tokens.textMuted, fontFamily: tokens.fontBody, fontWeight: '500', fontSize: tokens.type.xs }}>{delta}</Text> : null}
  </Pressable>;
}

export function OrderQuantityStepper({ quantity, min = 0, max, itemLabel, onDecrease, onIncrease, style }: { quantity: number; min?: number; max: number; itemLabel: string; onDecrease: () => void; onIncrease: () => void; style?: StyleProp<ViewStyle> }) {
  const tokens = useTokens();
  const removes = min <= 0 && quantity <= 1; const atMin = quantity <= min; const atMax = quantity >= max;
  const control = (label: string, glyph: string, disabled: boolean, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} disabled={disabled} {...disabledState(disabled)} onPress={onPress} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : pressed ? 0.72 : 1 })}><Text style={{ color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }}>{glyph}</Text></Pressable>;
  return <View style={[{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: tokens.radius.pill, backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.secondary }, style]}>{control(removes ? `Remove ${itemLabel}` : `One fewer ${itemLabel}`, removes ? '×' : '−', atMin, onDecrease)}<Text accessibilityLabel={`Quantity ${quantity}`} style={{ minWidth: 28, textAlign: 'center', color: tokens.textPrimary, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{quantity}</Text>{control(`One more ${itemLabel}`, '+', atMax, onIncrease)}</View>;
}
