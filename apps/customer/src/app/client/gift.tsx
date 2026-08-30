import { TabScreenSafeArea } from '@platform/ui';
import { GiftScreen } from '@/screens/client/gift-screen';
import { useAppState } from '@/state/app-context';

export default function ClientGiftRoute() {
  const { consumeGiftClaimToken, giftClaimToken } = useAppState();
  return (
    <TabScreenSafeArea>
      <GiftScreen initialClaimToken={giftClaimToken} onClaimTokenConsumed={consumeGiftClaimToken} />
    </TabScreenSafeArea>
  );
}
