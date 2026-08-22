import { InformationPage } from '@/screens/client/more/information-page';
import { useAppState } from '@/state/app-context';

export default function ClientMorePrivacyRoute() {
  const { openMore } = useAppState();
  return <InformationPage page="privacy" onBack={() => openMore('menu')} />;
}
