import { Profile } from '@/screens/client/more/profile-and-preferences';
import { ConstructionAccountScreen } from '@/screens/client/construction-info-screen';
import { BaseAccountScreen } from '@/screens/client/base-more-screen';
import { useAppState } from '@/state/app-context';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientMoreProfileRoute() {
  const { openMore } = useAppState();
  if (TENANT_CLIENT_EXPERIENCE.kind === 'construction') {
    return <ConstructionAccountScreen onBack={() => openMore('menu')} />;
  }
  if (TENANT_CLIENT_EXPERIENCE.kind === 'base') {
    return <BaseAccountScreen onBack={() => openMore('menu')} />;
  }
  return <Profile onBack={() => openMore('menu')} />;
}
