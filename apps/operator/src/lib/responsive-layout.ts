/** The smallest short edge that should receive tablet-density layouts. */
export const OPERATOR_TABLET_BREAKPOINT = 600;

/** The width at which the order board can show all three working lanes. */
export const OPERATOR_BOARD_WIDE_BREAKPOINT = 1024;

export type OperatorLayout = {
  isTablet: boolean;
  isLandscape: boolean;
  contentMaxWidth: number;
  boardColumnsVisible: 1 | 2 | 3;
};

/**
 * Selects layout modes from the live window rather than a device model name.
 * This covers iPad split view, rotation, Android tablets, and resizable web
 * previews with the same policy.
 */
export function operatorLayout(width: number, height: number): OperatorLayout {
  const normalizedWidth = Math.max(0, width);
  const normalizedHeight = Math.max(0, height);
  const isTablet = Math.min(normalizedWidth, normalizedHeight) >= OPERATOR_TABLET_BREAKPOINT;
  const boardColumnsVisible = normalizedWidth >= OPERATOR_BOARD_WIDE_BREAKPOINT
    ? 3
    : isTablet ? 2 : 1;

  return {
    isTablet,
    isLandscape: normalizedWidth > normalizedHeight,
    contentMaxWidth: isTablet ? 1120 : normalizedWidth,
    boardColumnsVisible,
  };
}
