import type { BrandTokens } from '@platform/ui';
import { createBoardLayoutStyles } from './board-layout-styles';
import { createBoardSheetStyles } from './board-sheet-styles';

export const createStyles = (tokens: BrandTokens) => ({
  ...createBoardLayoutStyles(tokens), ...createBoardSheetStyles(tokens),
});
