export type SetupStep = 'hub' | 'place' | 'details' | 'menu';
export type Overlay = 'none' | 'bag' | 'note' | 'checkout' | 'placed';

/**
 * The overlays, innermost last. A page stays presented while anything above
 * it is open, so going forward slides the next page over the current one and
 * coming back reveals it exactly as it was left -- rather than sliding the
 * old page off to the right at the same moment, briefly exposing the menu
 * between the two, and remounting it scrolled to the top on the way back.
 */
const OVERLAY_STACK: readonly Overlay[] = ['none', 'bag', 'note', 'checkout', 'placed'];

/** The setup pages, stacked the same way. `menu` is not an overlay: it is the
 *  tab screen itself, so reaching it replaces the hub rather than covering it. */
const SETUP_STACK: readonly SetupStep[] = ['hub', 'place', 'details', 'menu'];

export function overlayAtLeast(current: Overlay, level: Overlay): boolean {
  return OVERLAY_STACK.indexOf(current) >= OVERLAY_STACK.indexOf(level);
}

export function setupAtLeast(current: SetupStep, level: SetupStep): boolean {
  return SETUP_STACK.indexOf(current) >= SETUP_STACK.indexOf(level);
}
