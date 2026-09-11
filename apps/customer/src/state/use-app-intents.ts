import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { destinationForIntentUrl, giftTokenFromUrl } from '@platform/domain';

import type { ClientTab, MoreView } from './navigation-state';

type IntentHandlers = {
  openGiftClaim: (token: string) => void;
  openMore: (view: MoreView) => void;
  setClientTab: (tab: ClientTab) => void;
  startOrder: (itemId?: string) => void;
};

export function useAppIntents({ openGiftClaim, openMore, setClientTab, startOrder }: IntentHandlers) {
  useEffect(() => {
    const dispatch = (url: string | null) => {
      const giftToken = giftTokenFromUrl(url);
      if (giftToken) {
        openGiftClaim(giftToken);
        return;
      }
      const destination = destinationForIntentUrl(url);
      if (!destination) return;
      if (destination === 'book') startOrder();
      else if (destination === 'orders') openMore('orders');
      else setClientTab(destination);
    };
    void Linking.getInitialURL().then(dispatch);
    const subscription = Linking.addEventListener('url', ({ url }) => dispatch(url));
    return () => subscription.remove();
  }, [openGiftClaim, startOrder, openMore, setClientTab]);
}
