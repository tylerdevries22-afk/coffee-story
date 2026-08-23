import { Text, View } from 'react-native';
import { useCopy } from '@platform/ui';

import { styles } from './styles';

/**
 * The status mark that rides beside a tier name.
 *
 * The glyph comes from the brand copy dictionary (`rewardMark`), not from
 * here, because the same mark has to appear on the in-store pickup board — and
 * a second literal in a second app is how the two would drift the first time a
 * brand changed it. Rule 4: words and marks are tokens too.
 */
export function RewardMark({ compact = false }: { compact?: boolean }) {
  const copy = useCopy();
  return (
    <View style={[styles.rewardMark, compact && styles.rewardMarkCompact]}>
      <Text style={[styles.rewardMarkHeart, compact && styles.rewardMarkHeartCompact]}>
        {copy('rewardMark')}
      </Text>
    </View>
  );
}
