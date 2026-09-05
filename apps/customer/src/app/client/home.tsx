import { TabScreenSafeArea } from '@platform/ui';
import { HomeScreen } from '@/screens/client/home-screen';
import { BaseHomeScreen } from '@/screens/client/base-home-screen';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientHomeRoute() {
  return (
    <TabScreenSafeArea>
      {TENANT_CLIENT_EXPERIENCE.kind === 'base' ? <BaseHomeScreen /> : <HomeScreen />}
    </TabScreenSafeArea>
  );
}
