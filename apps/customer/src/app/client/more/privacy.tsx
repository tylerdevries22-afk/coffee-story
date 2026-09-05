import { InformationPage } from '@/screens/client/more/information-page';
import { ConstructionPrivacyScreen } from '@/screens/client/construction-info-screen';
import { useAppState } from '@/state/app-context';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientMorePrivacyRoute() {
  const { openMore } = useAppState();
  if (TENANT_CLIENT_EXPERIENCE.kind === 'construction') {
    return <ConstructionPrivacyScreen onBack={() => openMore('menu')} />;
  }
  return <InformationPage page="privacy" onBack={() => openMore('menu')} />;
}
