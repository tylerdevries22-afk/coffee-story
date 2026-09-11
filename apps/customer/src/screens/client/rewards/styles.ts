import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

import { createRewardBaseStyles } from './styles-base';
import { createRewardSheetStyles } from './styles-sheets';
import { createRewardStatusStyles } from './styles-status';

export const createStyles = (tokens: BrandTokens) => ({
  ...createRewardBaseStyles(tokens),
  ...createRewardStatusStyles(tokens),
  ...createRewardSheetStyles(tokens),
});

export function useRewardStyles() {
  return createStyles(useBrandTokens());
}
