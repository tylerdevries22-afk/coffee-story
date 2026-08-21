import { Text, View } from 'react-native';

import { styles } from './styles';

/** The gold diamond-and-spark points mark — the Coffee Story ✦. */
export function RewardMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.rewardMark, compact && styles.rewardMarkCompact]}>
      <Text style={[styles.rewardMarkHeart, compact && styles.rewardMarkHeartCompact]}>✦</Text>
    </View>
  );
}
