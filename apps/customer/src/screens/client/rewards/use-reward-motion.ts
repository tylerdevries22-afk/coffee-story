import { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { RewardTab } from './header';

export function useRewardMotion(tab: RewardTab, reducedMotion: boolean) {
  const [reveal] = useState(() => new Animated.Value(1));
  const [scrollY] = useState(() => new Animated.Value(0));
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);

  useEffect(() => {
    if (reducedMotion) {
      reveal.setValue(1);
      return;
    }
    reveal.setValue(0);
    Animated.spring(reveal, {
      toValue: 1,
      damping: 18,
      stiffness: 180,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, reveal, tab]);

  return { onScroll, reveal, scrollY };
}
