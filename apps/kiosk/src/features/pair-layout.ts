/**
 * Pairing keypad geometry, separate so every supported kiosk viewport is testable.
 *
 * `app/pair.tsx` reads the gap and the pad width from here. The key target
 * mirrors `KioskPressable`'s compact minimum, which is where a key actually
 * gets its size -- generic chrome must not depend on the pairing feature, so
 * the two are kept equal by hand and by the floor the test asserts.
 */
export const PAIR_KEY_TARGET = 64;
export const PAIR_KEY_GAP = 10;
export const PAIR_PAD_MAX_WIDTH = 860;

export function pairingKeyColumns(viewportWidth: number): number {
  const usableWidth = Math.min(PAIR_PAD_MAX_WIDTH, Math.max(PAIR_KEY_TARGET, viewportWidth - 64));
  return Math.max(1, Math.floor((usableWidth + PAIR_KEY_GAP) / (PAIR_KEY_TARGET + PAIR_KEY_GAP)));
}

export function pairingKeyRows(keyCount: number, viewportWidth: number): number {
  if (!Number.isFinite(keyCount) || keyCount <= 0) return 0;
  return Math.ceil(Math.trunc(keyCount) / pairingKeyColumns(viewportWidth));
}

export function pairingPadHeight(keyCount: number, viewportWidth: number): number {
  const rows = pairingKeyRows(keyCount, viewportWidth);
  return rows === 0 ? 0 : rows * PAIR_KEY_TARGET + (rows - 1) * PAIR_KEY_GAP;
}
