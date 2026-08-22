export type EarnActionBehavior = 'claim' | 'sheet' | 'link' | 'inert';

export type EarnAction = {
  key: string;
  label: string;
  points: number;
  behavior: EarnActionBehavior;
};

/**
 * The action catalogue is deliberately separate from the screen. A row may
 * open a sheet or a link without claiming points, so behavior is more precise
 * than a single `claimable` boolean.
 */
export const EARN_ACTIONS: readonly EarnAction[] = [
  { key: 'share_experience', label: 'Share Your Experience', points: 30, behavior: 'claim' },
  { key: 'refer_friend', label: 'Refer a Friend', points: 20, behavior: 'sheet' },
  { key: 'add_birthday', label: 'Add Your Birthday', points: 5, behavior: 'claim' },
  { key: 'complete_intake', label: 'Set Your Usual Order', points: 10, behavior: 'claim' },
  { key: 'google_review', label: 'Leave a Google Review', points: 5, behavior: 'link' },
  { key: 'enable_reminders', label: 'Enable Order Reminders', points: 5, behavior: 'inert' },
] as const;

export function earnActionState(
  action: EarnAction,
  completed: readonly string[],
  isDemo: boolean,
): { complete: boolean; awaitingStudio: boolean; inert: boolean } {
  const complete = completed.includes(action.key);
  const awaitingStudio = action.behavior === 'inert' && !isDemo && !complete;
  return { complete, awaitingStudio, inert: complete || awaitingStudio };
}
