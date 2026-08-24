/** The zero-bound cart stepper removes its last unit instead of decrementing it. */
export function stepperDecreaseLabel(value: number, min: number, label: string): string {
  const action = min === 0 && value === 1 ? 'Remove' : 'Decrease';
  return `${action} ${label.toLowerCase()}`;
}
