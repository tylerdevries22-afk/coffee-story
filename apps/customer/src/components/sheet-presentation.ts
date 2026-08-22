/**
 * The two curves a bottom sheet presents on, kept apart on purpose.
 *
 * A scrim may only ever *fade*: its output is a function of progress alone,
 * with no reference to the sheet's height or offset. That separation is the
 * whole fix -- `<Modal animationType="slide">` used to translate one container
 * holding both, so the dim swept up from the bottom edge with the sheet.
 *
 * Both are worklets so `useAnimatedStyle` can call them on the UI thread, and
 * both are plain arithmetic so `node:test` can call them too.
 */

function clampProgress(progress: number): number {
  'worklet';
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/** Dim strength at a given presentation progress. Never depends on geometry. */
export function scrimOpacity(progress: number, target: number): number {
  'worklet';
  return clampProgress(progress) * target;
}

/** How far below its resting place the sheet sits, in points. */
export function sheetOffset(progress: number, height: number): number {
  'worklet';
  return (1 - clampProgress(progress)) * Math.max(0, height);
}
