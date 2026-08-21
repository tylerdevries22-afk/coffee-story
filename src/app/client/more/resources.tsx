import { InformationPage } from '@/screens/client/more/information-page';
import { useAppState } from '@/state/app-context';

export default function ClientMoreResourcesRoute() {
  const { openMore } = useAppState();
  return <InformationPage page="resources" onBack={() => openMore('menu')} />;
}
