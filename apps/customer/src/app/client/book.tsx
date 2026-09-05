import { TabScreenSafeArea } from '@platform/ui';
import { OrderScreen } from '@/screens/client/order-screen';
import { ConstructionProjectScreen } from '@/screens/client/construction-project-screen';
import { BaseCatalogScreen } from '@/screens/client/base-catalog-screen';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientBookRoute() {
  const experience = TENANT_CLIENT_EXPERIENCE.kind;
  return (
    <TabScreenSafeArea>
      {experience === 'construction' ? <ConstructionProjectScreen />
        : experience === 'base' ? <BaseCatalogScreen /> : <OrderScreen />}
    </TabScreenSafeArea>
  );
}
