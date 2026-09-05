import { TabScreenSafeArea } from '@platform/ui';
import { MoreScreen } from '@/screens/client/more-screen';
import { ConstructionMoreScreen } from '@/screens/client/construction-more-screen';
import { BaseMoreScreen } from '@/screens/client/base-more-screen';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientMoreRoute() {
  const experience = TENANT_CLIENT_EXPERIENCE.kind;
  return (
    <TabScreenSafeArea>
      {experience === 'construction' ? <ConstructionMoreScreen />
        : experience === 'base' ? <BaseMoreScreen /> : <MoreScreen />}
    </TabScreenSafeArea>
  );
}
