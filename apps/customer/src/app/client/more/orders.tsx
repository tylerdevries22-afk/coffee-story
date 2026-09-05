import { Redirect } from 'expo-router';

import { Orders } from '@/screens/client/more/orders';
import { ConstructionProjectScreen } from '@/screens/client/construction-project-screen';
import { useAppState } from '@/state/app-context';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientMoreOrdersRoute() {
  const { openMore, startOrder } = useAppState();
  if (TENANT_CLIENT_EXPERIENCE.kind === 'construction') {
    return <ConstructionProjectScreen onBack={() => openMore('menu')} />;
  }
  if (TENANT_CLIENT_EXPERIENCE.kind === 'base') return <Redirect href="/client/home" />;
  return <Orders onBack={() => openMore('menu')} onBook={() => startOrder()} />;
}
