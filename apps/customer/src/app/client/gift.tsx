import { TabScreenSafeArea } from '@platform/ui';
import { Redirect } from 'expo-router';
import { GiftScreen } from '@/screens/client/gift-screen';
import { ConstructionDocumentsScreen } from '@/screens/client/construction-project-screen';
import { useAppState } from '@/state/app-context';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientGiftRoute() {
  const { consumeGiftClaimToken, giftClaimToken } = useAppState();
  const experience = TENANT_CLIENT_EXPERIENCE.kind;
  if (experience === 'base') return <Redirect href="/client/home" />;
  return (
    <TabScreenSafeArea>
      {experience === 'construction'
        ? <ConstructionDocumentsScreen />
        : <GiftScreen initialClaimToken={giftClaimToken} onClaimTokenConsumed={consumeGiftClaimToken} />}
    </TabScreenSafeArea>
  );
}
