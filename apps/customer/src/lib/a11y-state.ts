/**
 * Accessibility state that survives both renderers.
 *
 * react-native-web 0.21 forwards `aria-*` props straight through to the DOM
 * but no longer translates `accessibilityState` on `Pressable` -- so state set
 * only that way reaches iOS and Android correctly and is silently dropped on
 * the web demo. Every tab, chip and segmented control in the app announced
 * with no selected state to a screen reader in the browser.
 *
 * Each helper emits both halves, and pins which ARIA attribute belongs to
 * which role. That pairing matters: `aria-selected` is only meaningful on
 * tab/option/row, so a segmented control built out of `accessibilityRole
 * ="button"` needs `aria-pressed` instead. Deciding that here once is what
 * keeps it from being re-litigated at every call site.
 *
 * Spread the result onto the Pressable:
 *
 *     <Pressable accessibilityRole="tab" {...tabState(isCurrent)} />
 */

/** A tab in a tab list -- `accessibilityRole="tab"`. */
export function tabState(selected: boolean) {
  return { accessibilityState: { selected }, 'aria-selected': selected } as const;
}

/** One choice in a radio group or a checkbox -- `accessibilityRole="radio" | "checkbox"`. */
export function choiceState(checked: boolean) {
  return { accessibilityState: { checked }, 'aria-checked': checked } as const;
}

/**
 * A button that stays visibly on or off -- segmented controls, filter pills.
 * `aria-pressed` rather than `aria-selected`, which browsers ignore on a button.
 */
export function toggleState(pressed: boolean) {
  return { accessibilityState: { selected: pressed }, 'aria-pressed': pressed } as const;
}

/** A control that is present but not currently actionable. */
export function disabledState(disabled: boolean) {
  return { accessibilityState: { disabled }, 'aria-disabled': disabled } as const;
}

/** A disclosure control -- accordions, expanding shelves. */
export function expandedState(expanded: boolean) {
  return { accessibilityState: { expanded }, 'aria-expanded': expanded } as const;
}
