/** A tab in a tab list -- pair with `accessibilityRole="tab"`. */
export function tabState(selected: boolean) {
  return { accessibilityState: { selected }, 'aria-selected': selected } as const;
}

/** One choice in a radio group or checkbox. */
export function choiceState(checked: boolean) {
  return { accessibilityState: { checked }, 'aria-checked': checked } as const;
}

/** A button that stays visibly on or off. */
export function toggleState(pressed: boolean) {
  return { accessibilityState: { selected: pressed }, 'aria-pressed': pressed } as const;
}

/** A control that is present but not currently actionable. */
export function disabledState(disabled: boolean) {
  return { accessibilityState: { disabled }, 'aria-disabled': disabled } as const;
}

/** A disclosure control such as an accordion. */
export function expandedState(expanded: boolean) {
  return { accessibilityState: { expanded }, 'aria-expanded': expanded } as const;
}
