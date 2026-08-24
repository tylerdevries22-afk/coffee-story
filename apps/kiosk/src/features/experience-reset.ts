export type ExperienceResetActions = {
  resetSession: () => void;
  clearGuest: () => void;
  resetBuilder: () => void;
  navigate: () => void;
};

/**
 * One privacy boundary for every way a kiosk session ends. Navigation is last
 * so the next route can never render with the previous guest's identity or an
 * abandoned builder, even for a single frame.
 */
export function resetExperience(
  actions: ExperienceResetActions,
  sessionAlreadyReset = false,
): void {
  if (!sessionAlreadyReset) actions.resetSession();
  actions.clearGuest();
  actions.resetBuilder();
  actions.navigate();
}
